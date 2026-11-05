// Diagnostic counters only; called by explicitly authorized task-browser experiments.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
function validPid(pid){if(!Number.isSafeInteger(pid)||pid<1||pid>2147483647)throw Error('Invalid browser PID');}
async function verifyBrowserPid(browser,pid){
 validPid(pid);const session=await browser.newBrowserCDPSession();
 try{
  const info=await session.send('SystemInfo.getProcessInfo'),roots=info.processInfo?.filter(process=>process.type==='browser');
  if(roots?.length!==1||roots[0].id!==pid)throw Error('Browser PID does not match the launch receipt');
  return pid;
 }finally{await session.detach().catch(()=>{});}
}
async function captureBrowserResources(pid,phase,{exec=execute}={}){
 validPid(pid);
 const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$ErrorActionPreference='Stop';([System.Diagnostics.Process]::GetCurrentProcess()).PriorityClass='BelowNormal';$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${pid});do{$added=$false;foreach($proc in $all){if($ids.Contains([int]$proc.ParentProcessId) -and $ids.Add([int]$proc.ProcessId)){$added=$true}}}while($added);$samples=@(foreach($i in $ids){$proc=Get-Process -Id $i -ErrorAction SilentlyContinue;if($proc){[pscustomobject]@{workingSetBytes=$proc.WorkingSet64;privateBytes=$proc.PrivateMemorySize64}}});$os=Get-CimInstance Win32_OperatingSystem;@{processCount=$samples.Count;workingSetSum=[long](($samples|Measure-Object -Property workingSetBytes -Sum).Sum);privateBytesSum=[long](($samples|Measure-Object -Property privateBytes -Sum).Sum);freePhysicalBytes=([long]$os.FreePhysicalMemory*1024);freeVirtualBytes=([long]$os.FreeVirtualMemory*1024)}|ConvertTo-Json -Compress`;
 const measured={phase,observedAt:new Date().toISOString()},started=performance.now();
 await Promise.all([
  exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:15000,encoding:'utf8'}).then(({stdout})=>{
   const sample=JSON.parse(stdout);
   if(!sample||!['processCount','workingSetSum','privateBytesSum'].every(key=>Number.isSafeInteger(sample[key])&&sample[key]>=0))throw Error('Invalid memory sample');
   measured.browserProcessMemory={processCount:sample.processCount,workingSetSum:sample.workingSetSum,privateBytesSum:sample.privateBytesSum};
   if(['freePhysicalBytes','freeVirtualBytes'].every(key=>Number.isSafeInteger(sample[key])&&sample[key]>=0))measured.systemMemory={freePhysicalBytes:sample.freePhysicalBytes,freeVirtualBytes:sample.freeVirtualBytes};
  }).catch(error=>{measured.browserMemoryObservationError=error.code||error.name;}),
  exec('nvidia-smi',['--query-gpu=memory.used,memory.total','--format=csv,noheader,nounits'],{timeout:10000,encoding:'utf8'}).then(({stdout})=>{
   const rows=stdout.trim().split('\n').map(line=>line.split(',').map(Number));
   if(!rows.length||rows.some(row=>row.length!==2||row.some(value=>!Number.isFinite(value)||value<0)||row[0]>row[1]))throw Error('Invalid GPU sample');
   measured.wholeGpuMiB=rows;
  }).catch(error=>{measured.gpuMemoryObservationError=error.code||error.name;})
 ]);
 measured.observationMs=performance.now()-started;return measured;
}
function isTaskProfile(profile){return typeof profile==='string'&&/^C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\image-studio-plan36-[A-Za-z0-9-]+$/i.test(profile);}
async function stopTaskBrowser(pid,profile,{exec=execute}={}){
 validPid(pid);
 if(!isTaskProfile(profile))throw Error('Expected task-only temporary Chrome profile');
 const literal=profile.replace(/'/g,"''");
 const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$ErrorActionPreference='Stop';$profile='${literal}';$escaped=[regex]::Escape($profile);$pattern='(?:^|\\s)(?:"--user-data-dir='+$escaped+'"|--user-data-dir="'+$escaped+'"|--user-data-dir='+$escaped+')(?:\\s|$)';$all=@(Get-CimInstance Win32_Process);$root=$all|Where-Object ProcessId -eq ${pid};if($root -and ($root.Name -ne 'chrome.exe' -or $root.CommandLine -notmatch $pattern)){throw 'Task browser identity mismatch'};$owned=@($all|Where-Object {$_.Name -eq 'chrome.exe' -and $_.CommandLine -match $pattern});foreach($item in $owned){Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue};@{stopped=$owned.Count}|ConvertTo-Json -Compress`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:15000,encoding:'utf8'});
 const value=JSON.parse(stdout);if(!Number.isSafeInteger(value?.stopped)||value.stopped<0)throw Error('Invalid task shutdown result');return {stopped:value.stopped};
}
module.exports={captureBrowserResources,verifyBrowserPid,stopTaskBrowser,isTaskProfile};
