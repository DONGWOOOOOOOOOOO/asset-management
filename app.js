// 기존 app.js 상단의 URL과 anon key를 아래 두 값에 복사하세요.
// service_role 또는 sb_secret 키는 절대 사용하지 마세요.
const SUPABASE_URL = "https://pexcpehmgxpqkkxcsbhi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBleGNwZWhtZ3hwcWtreGNzYmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMDc2MzQsImV4cCI6MjEwODg4MzYzNH0.6Hg1nSxzjQmyWb2laoZUi7HY8f1mm4rFfOL9V8v8290";
const $ = s => document.querySelector(s);
let db=null,user=null,profile=null,tab="assets",initialData=null;
let cache={assets:[],requests:[],checkouts:[],history:[],profiles:[]};
const labels={assets:["자산번호","자산명","담당자","보관장소","상태","반출자","반출일","비고"],requests:["신청번호","신청일","자산명","신청자","수량","보관장소","비고"],checkouts:["반출번호","자산번호","반출자","반출일","예정반납일","실제반납일","비고"]};
const fields={assets:[["asset_name","자산명"],["manager","담당자"],["location","보관장소"],["notes","비고"]],requests:[["request_date","신청일","date"],["asset_name","자산명"],["manager","신청자"],["quantity","수량","number"],["location","보관장소"],["notes","비고"]],checkouts:[["asset_no","자산번호","select"],["borrower","반출자"],["checkout_date","반출일","date"],["due_date","예정반납일","date"],["returned_date","실제반납일","date"],["notes","비고"]]};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isAdmin=()=>profile?.role==="admin";
const canEdit=()=>["admin","editor"].includes(profile?.role);
const roleName=r=>({admin:"관리자",editor:"편집자",viewer:"조회자"})[r]||r;
function msg(t){$("#notice").textContent=t}
function setConnection(ok,t){$("#connection").textContent=t;$("#connection").classList.toggle("off",!ok)}
function today(){return new Date().toISOString().slice(0,10)}



async function start() {
  try {
    // 초기 데이터 파일 읽기
    try {
      const response = await fetch("initial-data.json");
      if (!response.ok) {
        throw new Error("초기 데이터 파일을 읽을 수 없습니다.");
      }
      initialData = await response.json();
    } catch (e) {
      console.warn("초기 데이터 파일 확인:", e.message);
      initialData = {
        assets: [],
        requests: [],
        checkouts: []
      };
    }

    // Supabase 연결
    db = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    // 기존 세션 확인
    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    user = data.session?.user || null;

    // 세션이 없으면 익명 로그인
    if (!user) {
      const { data: anonData, error: anonError } =
        await db.auth.signInAnonymously();

      if (anonError) throw anonError;
      user = anonData.user;
    }

    // 사용자 및 데이터 초기화
    await ensureProfile();
    if (profile) await seedIfEmpty();
    await loadAll();
    subscribe();

    // 화면 표시
    updateLoginUI();

    setConnection(true, "Supabase 연결 완료");

    msg(
      profile ? `접속 사용자: ${profile.display_name || "익명 사용자"} · 권한: ${roleName(profile.role)} · 자동 저장 사용` : "이름 미등록 · 조회 전용 (이름 등록 후 편집 가능)"
    );

    if (
      !profile?.display_name ||
      profile.display_name.startsWith("사용자-")
    ) {
      $("#nameDialog").showModal();
    }

  } catch (e) {
    console.error("[SUPABASE CONNECTION ERROR]", e);
    setConnection(false, "연결 오류");
    msg("연결 오류: " + (e.message || "알 수 없는 오류"));
  }
}
async function ensureProfile(){
  // 페이지 접속만으로 profiles 행을 생성하지 않습니다.
  const {data,error}=await db.from("profiles")
    .select("id,display_name,role").eq("id",user.id).maybeSingle();
  if(error) throw error;
  profile=data||null;
}
function showNameDialog(){
  if(!$("#nameDialog").open) $("#nameDialog").showModal();
}
// 화면 표시 상태 변경
function updateLoginUI(){
  const admin=isAdmin();

  $("#loginPage").hidden=true;
  $("#appShell").hidden=false;

  $("#adminLoginOpen").hidden=admin;
  $("#adminLogoutBtn").hidden=!admin;

  $("#usersTab").hidden=!admin;
  $("#historyTab").hidden=!admin;
  $("#importLabel").hidden=!canEdit();
  $("#registerNameBtn").hidden=!!profile;
}

// 관리자 로그인 화면 열기
$("#adminLoginOpen").onclick=()=>{
  $("#appShell").hidden=true;
  $("#loginPage").hidden=false;
  $("#loginError").textContent="";
  $("#adminEmail").value="";
  $("#adminPassword").value="";
};

// 일반 사용자 화면으로 돌아가기
$("#cancelLoginBtn").onclick=()=>{
  $("#loginPage").hidden=true;
  $("#appShell").hidden=false;
};

// 관리자 로그인 실행
$("#adminLoginForm").onsubmit=async e=>{
  e.preventDefault();

  const email=$("#adminEmail").value.trim();
  const password=$("#adminPassword").value;

  $("#adminLoginBtn").disabled=true;
  $("#loginError").textContent="로그인 확인 중...";

  try{
    const {data,error}=await db.auth.signInWithPassword({
      email,
      password
    });

    if(error) throw error;

    user=data.user;

    await ensureProfile();

    // 관리자 권한이 없는 계정은 관리자 화면 진입 차단
    if(!isAdmin()){
      await db.auth.signOut();

      const {data:anonData,error:anonError}=
        await db.auth.signInAnonymously();

      if(anonError) throw anonError;

      user=anonData.user;
      await ensureProfile();
      await loadAll();
      updateLoginUI();
      if(!profile) msg("이름 미등록 · 조회 전용 (이름 등록 후 편집 가능)");

      throw new Error("관리자 권한이 없는 계정입니다.");
    }

    cache.profiles=[];
    await loadAll();
    updateLoginUI();

    msg("관리자로 로그인되었습니다.");

  }catch(err){
    console.error(err);
    $("#loginError").textContent=err.message;
  }finally{
    $("#adminLoginBtn").disabled=false;
  }
};

// 관리자 로그아웃 후 일반 사용자로 전환
$("#adminLogoutBtn").onclick=async()=>{
  if(!confirm("관리자 로그아웃 후 일반 사용자 화면으로 이동할까요?"))return;

  try{
    const {error}=await db.auth.signOut();
    if(error) throw error;

    const {data,error:anonError}=
      await db.auth.signInAnonymously();

    if(anonError) throw anonError;

    user=data.user;
    profile=null;
    cache.profiles=[];

    await ensureProfile();
    await loadAll();
    updateLoginUI();

    msg(profile ? "일반 사용자로 접속했습니다." : "이름 미등록 · 조회 전용 (이름 등록 후 편집 가능)");

  }catch(err){
    alert("로그아웃 처리 실패: "+err.message);
  }
};
async function seedIfEmpty(){
 let {count,error}=await db.from("assets").select("*",{count:"exact",head:true});if(error)throw error;
 if(count===0&&initialData.assets?.length){const {error:e}=await db.rpc("seed_office_assets",{payload:initialData});if(e)msg("초기 데이터 자동 등록을 건너뛰었습니다.")}
}
async function loadAll(){
 for(const t of ["assets","requests","checkouts"]){const {data,error}=await db.from(t).select("*").order("created_at",{ascending:true});if(error)throw error;cache[t]=data||[]}
 if(isAdmin()){
  const h=await db.from("audit_log").select("*").order("created_at",{ascending:false}).limit(250);
  if(h.error)throw h.error;
  cache.history=h.data||[];
 }else{cache.history=[];}
 if(isAdmin()){const p=await db.from("profiles").select("id,display_name,role,created_at").order("created_at",{ascending:true});if(p.error)throw p.error;cache.profiles=p.data||[]}
 render();
}
function subscribe(){["assets","requests","checkouts","audit_log","profiles"].forEach(t=>db.channel("live-"+t).on("postgres_changes",{event:"*",schema:"public",table:t},()=>loadAll()).subscribe())}
function render(){
 const a=cache.assets,out=a.filter(x=>x.status==="반출중").length;
 $("#summary").innerHTML=[["전체 자산",a.length],["보관중",a.length-out],["반출중",out],["등록 사용자",isAdmin()?cache.profiles.length:"—"]].map(x=>`<div class="stat"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
 $("#tabs").querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
 $("#addBtn").style.display=(tab==="history"||tab==="users"||!canEdit())?"none":"inline-block";
 $("#requestTemplateBtn").style.display=tab==="requests"?"inline-block":"none";
 const q=$("#search").value.toLowerCase();
 if(tab==="users"){if(!isAdmin()){tab="assets";render();return}renderUsers(cache.profiles.filter(x=>JSON.stringify(x).toLowerCase().includes(q)));return}
 if(tab==="history"){if(!isAdmin()){tab="assets";render();return}renderHistory(cache.history.filter(x=>JSON.stringify(x).toLowerCase().includes(q)));return}
 const rows=(cache[tab]||[]).filter(x=>JSON.stringify(x).toLowerCase().includes(q)),cols=labels[tab];
 $("#tableArea").innerHTML=rows.length?`<table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}<th>관리</th></tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>`:'<div class="empty">등록된 데이터가 없습니다.</div>';
 $("#tableArea").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openEdit(tab,b.dataset.edit));
 $("#tableArea").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>removeRow(tab,b.dataset.del));
}
function rowHtml(x){
 const cells=tab==="assets"?[x.asset_no,x.asset_name,x.manager,x.location,`<span class="status ${x.status==="반출중"?"out":""}">${esc(x.status)}</span>`,x.borrower,x.checkout_date,x.notes]:tab==="requests"?[x.request_no,x.request_date,x.asset_name,x.manager,x.quantity,x.location,x.notes]:[x.checkout_no,x.asset_no,x.borrower,x.checkout_date,x.due_date,x.returned_date,x.notes];
 let actions=canEdit()?`<button data-edit="${esc(x.id)}">수정</button> `:"";if(isAdmin())actions+=`<button data-del="${esc(x.id)}">삭제</button>`;
 return `<tr>${cells.map(v=>`<td>${v===undefined||v===null?"":String(v).startsWith("<span")?v:esc(v)}</td>`).join("")}<td class="row-actions">${actions||"—"}</td></tr>`;
}
function renderHistory(rows){$("#tableArea").innerHTML=rows.length?`<table><thead><tr><th>일시</th><th>사용자</th><th>작업</th><th>대상</th><th>변경 요약</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString("ko-KR")}</td><td>${esc(x.actor_name||"사용자")}</td><td>${esc(x.action)}</td><td>${esc(x.table_name)}</td><td>${esc(x.summary||"")}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">수정 이력이 없습니다.</div>'}
function renderUsers(rows){
 $("#tableArea").innerHTML=`<p class="muted">권한은 관리자 전용 데이터베이스 함수로 변경됩니다. 본인 계정의 권한은 변경할 수 없습니다.</p>${rows.length?`<table><thead><tr><th>표시 이름</th><th>사용자 ID</th><th>현재 권한</th><th>권한 변경</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.display_name)}</td><td style="font-size:11px;word-break:break-all">${esc(x.id)}</td><td>${roleName(x.role)}</td><td>${x.id===user.id?"본인 계정":`<select data-role="${esc(x.id)}"><option value="admin" ${x.role==="admin"?"selected":""}>관리자</option><option value="editor" ${x.role==="editor"?"selected":""}>편집자</option><option value="viewer" ${x.role==="viewer"?"selected":""}>조회자</option></select> <button data-save-role="${esc(x.id)}">변경</button>`}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">등록된 사용자가 없습니다.</div>'}`;
 $("#tableArea").querySelectorAll("[data-save-role]").forEach(b=>b.onclick=()=>changeRole(b.dataset.saveRole));
}
async function changeRole(id){
 const sel=$("#tableArea").querySelector(`[data-role="${CSS.escape(id)}"]`);if(!sel)return;
 if(!confirm(`이 사용자의 권한을 ${roleName(sel.value)}(으)로 변경할까요?`))return;
 const {error}=await db.rpc("admin_set_user_role",{target_user_id:id,new_role:sel.value});
 if(error){alert("권한 변경 실패: "+error.message);return}
 await loadAll();msg("사용자 권한이 변경되었습니다.");
}
function openEdit(t,id=null){
 if(!canEdit()){alert("수정 권한이 없습니다.");return}
 const item=id?(cache[t]||[]).find(x=>x.id===id):{};
 $("#dialogTitle").textContent=(id?"정보 수정":"신규 등록")+" · "+({assets:"자산",requests:"자산 신청",checkouts:"자산 반출"}[t]);
 $("#formFields").innerHTML=fields[t].map(([key,label,type])=>{const val=item?.[key]??(key==="quantity"?1:"");if(type==="select")return `<label class="field">${label}<select name="${key}">${cache.assets.map(a=>`<option value="${esc(a.asset_no)}" ${a.asset_no===val?"selected":""}>${esc(a.asset_no+" · "+a.asset_name)}</option>`).join("")}</select></label>`;return `<label class="field ${key==="notes"?"full":""}">${label}<input name="${key}" type="${type||"text"}" value="${esc(val)}" ${["asset_name","borrower","checkout_date","due_date","quantity"].includes(key)?"required":""} ${key==="quantity"?'min="1" step="1"':""}></label>`}).join("");
 $("#editDialog").showModal();
 $("#saveDialog").onclick=async e=>{e.preventDefault();try{await saveRow(t,id,Object.fromEntries(new FormData($("#editForm")).entries()));$("#editDialog").close()}catch(err){alert("저장 실패: "+err.message)}};
}
function nextRequestNumber(usedNumbers=null){
 const used=usedNumbers||new Set(cache.requests.map(x=>String(x.request_no||"")));
 let max=0;
 for(const row of cache.requests){
  const match=String(row.request_no||"").match(/^REQ-(\d+)$/i);
  if(match)max=Math.max(max,Number(match[1]));
 }
 let next=max+1;
 let candidate="REQ-"+String(next).padStart(3,"0");
 while(used.has(candidate)){next++;candidate="REQ-"+String(next).padStart(3,"0");}
 return candidate;
}

async function saveRow(t,id,d){
 if(!canEdit())throw Error("수정 권한이 없습니다.");
 if(t==="assets"&&!id){d.asset_no="AS-"+String(Math.max(0,...cache.assets.map(x=>Number((x.asset_no||"").split("-")[1])||0))+1).padStart(3,"0");d.status="보관중"}
 if(t==="requests"){
  d.quantity=Number.parseInt(d.quantity,10);
  if(!Number.isInteger(d.quantity)||d.quantity<1)throw Error("수량은 1 이상의 정수로 입력하세요.");
  if(!id)d.request_no=nextRequestNumber();
 }
 if(t==="checkouts"){
  // 실제 반납일은 반출 등록 시 비워둘 수 있습니다.
  d.returned_date=d.returned_date||null;
  d.checkout_date=d.checkout_date||null;
  d.due_date=d.due_date||null;
  if(!d.asset_no)throw Error("반출할 자산을 선택하세요.");
  if(!d.borrower?.trim())throw Error("반출자를 입력하세요.");
  if(!d.checkout_date)throw Error("반출일을 입력하세요.");
  if(!d.due_date)throw Error("예정 반납일을 입력하세요.");
  if(!id)d.checkout_no="OUT-"+String(cache.checkouts.length+1).padStart(3,"0");
  const saveResult=id?await db.from(t).update(d).eq("id",id):await db.from(t).insert(d);
  if(saveResult.error)throw saveResult.error;
  // 반출 등록 시 반출중, 실제 반납일 입력 시 보관중으로 자산 상태를 동기화합니다.
  const assetUpdate=d.returned_date
   ?{status:"보관중",borrower:null,checkout_date:null}
   :{status:"반출중",borrower:d.borrower,checkout_date:d.checkout_date};
  const {error:assetError}=await db.from("assets").update(assetUpdate).eq("asset_no",d.asset_no);
  if(assetError)throw Error("반출 정보는 저장됐지만 자산 상태 변경에 실패했습니다: "+assetError.message);
 }else{
  const {error}=id?await db.from(t).update(d).eq("id",id):await db.from(t).insert(d);if(error)throw error;
 }
 await loadAll();
}
// 자산대장/신청은 request_no 로만 연동합니다. 이름이 같은 항목은 연동하지 않습니다.
async function removeRow(t,id){
 if(!isAdmin()){alert("삭제는 관리자만 할 수 있습니다.");return;}
 if(t==="assets"||t==="requests"){
  const row=(cache[t]||[]).find(x=>x.id===id);
  if(!row){alert("삭제할 내역을 찾을 수 없습니다.");return;}
  const requestNo=String(row.request_no||"").trim();
  const candidates=t==="assets"
   ?cache.requests.filter(x=>requestNo&&x.request_no===requestNo)
   :cache.assets.filter(x=>requestNo&&x.request_no===requestNo);
  const requestMatches=cache.requests.filter(x=>requestNo&&x.request_no===requestNo);
  const assetMatches=cache.assets.filter(x=>requestNo&&x.request_no===requestNo);
  if(requestNo&&(requestMatches.length>1||assetMatches.length>1)){
   alert(`신청번호 ${requestNo}가 중복되어 연결 대상을 정확히 확인할 수 없습니다. 삭제하지 않았습니다.`);
   return;
  }
  const partner=candidates[0];
  const asset=t==="assets"?row:partner;
  const checkoutCount=asset?cache.checkouts.filter(x=>x.asset_no===asset.asset_no).length:0;
  const currentLabel=t==="assets"?`자산 ${row.asset_no}`:`신청 ${row.request_no||"(번호 없음)"}`;
  const linkedLabel=partner?(t==="assets"?`연결된 신청 ${partner.request_no}`:`연결된 자산 ${partner.asset_no}`):"연결된 반대편 항목 없음";
  const explanation=`${currentLabel} 삭제\n${linkedLabel}${checkoutCount?`\n관련 반출 기록 ${checkoutCount}건도 삭제됩니다.`:""}\n\n신청번호가 정확히 일치하는 항목만 연동하며 복구가 어려울 수 있습니다. 계속할까요?`;
  if(!confirm(explanation))return;
  const {error}=await db.rpc("admin_delete_linked_asset_request",{target_table:t,target_id:id});
  if(error){alert("삭제 실패: "+error.message+"\nSQL migration 적용 및 신청번호 중복 여부를 확인하세요.");return;}
  await loadAll();
  msg(`${currentLabel} 삭제를 완료했습니다. ${linkedLabel}.`);
  return;
 }
 if(t==="checkouts"){
  // 기존 자산반출 연동 삭제 로직을 유지합니다.
  const row=(cache.checkouts||[]).find(x=>x.id===id);
  if(!row){alert("선택한 내역을 찾을 수 없습니다.");return;}
  const assetNo=row.asset_no;
  const related=cache.checkouts.filter(x=>x.asset_no===assetNo).length;
  if(!confirm(`자산번호 ${assetNo}의 자산대장 1건과 연결된 반출 기록 ${related}건을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`))return;
  const {error}=await db.rpc("admin_delete_asset_and_checkouts",{target_table:t,target_id:id});
  if(error){alert("연동 삭제 실패: "+error.message);return;}
  await loadAll();
  msg(`자산번호 ${assetNo} 관련 자산대장 및 반출 기록을 삭제했습니다.`);
  return;
 }
 if(!confirm("이 항목을 삭제할까요?"))return;
 const {error}=await db.from(t).delete().eq("id",id);
 if(error)alert(error.message);else await loadAll();
}
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(!b)return;if(["users","history"].includes(b.dataset.tab)&&!isAdmin()){alert("관리자만 접근할 수 있습니다.");return}tab=b.dataset.tab;render()});
$("#search").addEventListener("input",render);
$("#addBtn").onclick=()=>openEdit(tab);
$("#editCancel").onclick=()=>$("#editDialog").close();
$("#editClose").onclick=()=>$("#editDialog").close();
$("#nameClose").onclick=()=>$("#nameDialog").close();
$("#registerNameBtn").onclick=showNameDialog;
$("#nameSave").onclick=async e=>{
  e.preventDefault();
  const name=$("#displayName").value.trim();
  if(!name)return;
  const btn=$("#nameSave");
  btn.disabled=true;
  try{
    if(!profile){
      // 이름을 확인한 시점에만 첫 profiles 행을 생성합니다.
      const {data,error}=await db.from("profiles")
        .insert({id:user.id,display_name:name,role:"editor"})
        .select("id,display_name,role").single();
      if(error) throw error;
      profile=data;
    }else{
      const {error}=await db.rpc("update_my_display_name",{new_name:name});
      if(error) throw error;
      profile.display_name=name;
    }
    $("#nameDialog").close();
    updateLoginUI();
    msg(`접속 사용자: ${profile.display_name} · 권한: ${roleName(profile.role)} · 자동 저장 사용`);
    await loadAll();
  }catch(err){
    alert("이름 등록 실패: "+err.message);
  }finally{btn.disabled=false;}
};
function latestRequestSequence(){
 let max=0;
 for(const row of cache.requests){
  const match=String(row.request_no||"").match(/^REQ-(\d+)$/i);
  if(match)max=Math.max(max,Number(match[1]));
 }
 return max+1;
}

function downloadRequestTemplate(){
 const wb=XLSX.utils.book_new();
 const headers=["신청번호","신청자","신청일","자산명","수량","비고"];
 const rows=[headers];
 for(let i=0;i<100;i++)rows.push(["","","","","",""]);
 const ws=XLSX.utils.aoa_to_sheet(rows);
 const first=latestRequestSequence();
 for(let row=2;row<=101;row++){
  const cell="A"+row;
  ws[cell]={t:"str",f:`IF(D${row}<>"","REQ-"&TEXT(COUNTA($D$2:D${row})+${first-1},"000"),"")`};
 }
 ws["!cols"]=[{wch:16},{wch:18},{wch:15},{wch:28},{wch:10},{wch:30}];
 ws["!autofilter"]={ref:"A1:F101"};
 ws["!freeze"]={xSplit:0,ySplit:1,topLeftCell:"A2",activePane:"bottomLeft",state:"frozen"};
 XLSX.utils.book_append_sheet(wb,ws,"자산신청");
 const guide=XLSX.utils.aoa_to_sheet([
  ["작성 안내"],
  ["자산명을 입력하면 신청번호가 REQ-001 형식으로 자동 표시됩니다."],
  ["신청번호 열은 자동 계산되므로 직접 수정하지 마세요."],
  ["신청자, 신청일, 자산명, 수량, 비고를 작성한 뒤 저장하고 웹페이지에서 업로드하세요."],
  ["신청일은 YYYY-MM-DD 형식으로 입력하는 것을 권장합니다."],
  ["수량은 1 이상의 정수로 입력하세요."]
 ]);
 guide["!cols"]=[{wch:95}];
 XLSX.utils.book_append_sheet(wb,guide,"작성안내");
 wb.Workbook=wb.Workbook||{};
 wb.Workbook.CalcPr={calcMode:"auto",fullCalcOnLoad:true,forceFullCalc:true};
 XLSX.writeFile(wb,"신규_자산신청_양식.xlsx");
}

$("#requestTemplateBtn").onclick=downloadRequestTemplate;

$("#exportBtn").onclick=()=>{const wb=XLSX.utils.book_new();for(const [t,rows] of [["자산대장",cache.assets],["자산신청",cache.requests],["자산반출",cache.checkouts]]){const clean=rows.map(({id,created_at,updated_at,...r})=>r);XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(clean),t)}XLSX.writeFile(wb,"사무실_자산관리_내보내기.xlsx")};

$("#importFile").onchange=async e=>{
 const file=e.target.files[0];
 if(!file)return;
 if(!canEdit()){alert("업로드 권한이 없습니다.");e.target.value="";return;}
 try{
  const buf=await file.arrayBuffer();
  const book=XLSX.read(buf,{cellDates:true});
  const sheetName=book.SheetNames.includes("자산신청")?"자산신청":book.SheetNames[0];
  const sheet=book.Sheets[sheetName];
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});
  const headerIndex=matrix.findIndex(row=>row.some(v=>["자산명","asset_name"].includes(String(v).trim())));
  if(headerIndex<0)throw Error("자산명 열이 있는 신청 양식을 찾을 수 없습니다.");
  const data=XLSX.utils.sheet_to_json(sheet,{defval:"",range:headerIndex});
  const valid=data.filter(r=>String(r["자산명"]||r.asset_name||"").trim());
  if(!valid.length){alert("자산명이 입력된 신청 행이 없습니다.");return;}
  if(!confirm(`${valid.length}개 행을 신규 자산신청으로 추가할까요? 기존 데이터는 삭제하지 않습니다.`))return;

  const used=new Set(cache.requests.map(x=>String(x.request_no||"")));
  let next=latestRequestSequence();
  for(let i=0;i<valid.length;i++){
   const r=valid[i];
   const name=String(r["자산명"]||r.asset_name||"").trim();
   if(!name)continue;
   let dt=r["신청일"]||r.request_date||today();
   if(dt instanceof Date)dt=dt.toISOString().slice(0,10);
   else if(typeof dt==="number"){
    const parsed=XLSX.SSF.parse_date_code(dt);
    dt=parsed?`${parsed.y}-${String(parsed.m).padStart(2,"0")}-${String(parsed.d).padStart(2,"0")}`:today();
   }else if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dt)))dt=today();
   let requestNo=String(r["신청번호"]||r.request_no||"").trim();
   if(!/^REQ-\d{3,}$/i.test(requestNo)||used.has(requestNo)){
    requestNo="REQ-"+String(next).padStart(3,"0");
    while(used.has(requestNo)){next++;requestNo="REQ-"+String(next).padStart(3,"0");}
   }
   used.add(requestNo);
   const applicant=String(r["신청자"]||r["담당자"]||r.manager||"").trim();
   const rawQty=r["수량"]??r.quantity??1;
   const quantity=Number.parseInt(rawQty,10);
   if(!Number.isInteger(quantity)||quantity<1)throw Error(`${name}: 수량은 1 이상의 정수로 입력하세요.`);
   const notes=String(r["비고"]||r.notes||"").trim();
   const {error}=await db.from("requests").insert({
    request_no:requestNo,
    request_date:String(dt),
    asset_name:name,
    manager:applicant,
    quantity,
    location:String(r["보관장소"]||r.location||""),
    notes
   });
   if(error)throw error;
   const match=requestNo.match(/^REQ-(\d+)$/i);
   if(match)next=Math.max(next,Number(match[1])+1);
  }
  await loadAll();
  alert("신규 자산 신청 업로드가 완료되었습니다.");
 }catch(err){
  console.error(err);
  alert("업로드 실패: "+(err.message||"알 수 없는 오류"));
 }finally{e.target.value="";}
};
start();
