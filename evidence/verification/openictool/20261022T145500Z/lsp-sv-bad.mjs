import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const R = process.env.ROOT, CWD = process.env.WS, EV = process.env.EV;
const p = spawn('node', [R+'/packages/mpd-mcp-lsp/launch.mjs', R+'/packages/mpd-mcp-lsp/dist/cli.js', 'mcp'], { cwd: CWD, env: process.env, stdio: ['pipe','pipe','pipe'] });
let buf=''; const out=[];
p.stdout.on('data', d => { buf += d; let i; while ((i=buf.indexOf('\n'))>=0) { const l=buf.slice(0,i); buf=buf.slice(i+1); try { out.push(JSON.parse(l)); } catch {} } });
p.stderr.on('data', d => process.stderr.write('LSPWARN '+d));
const send = o => p.stdin.write(JSON.stringify(o)+'\n');
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'openictool',version:'1'}}});
const timer = setTimeout(() => { console.log('TIMEOUT'); p.kill(); process.exit(0); }, 90000);
const onMsg = (m) => {
  if (m.id===1) { console.log('init', m.result?.protocolVersion); send({jsonrpc:'2.0',method:'notifications/initialized'}); send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}); }
  if (m.id===2) { const ts=m.result?.tools||[]; console.log('tools', ts.map(t=>t.name).join(',')); send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'status',arguments:{}}}); }
  if (m.id===3) { const text = (m.result?.content||[]).map(c=>c.text||'').join('\n'); writeFileSync(EV+'/lsp-status.txt', text); console.log('status text bytes', text.length); send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'diagnostics',arguments:{filePath: CWD+'/ic/bad.sv'}}}); }
  if (m.id===4) { const text = (m.result?.content||[]).map(c=>c.text||'').join('\n'); writeFileSync(EV+'/lsp-diagnostics.txt', text); console.log('diagnostics text bytes', text.length); console.log(text.slice(0,1200)); clearTimeout(timer); p.kill(); }
};
const poll = setInterval(() => { while (out.length) onMsg(out.shift()); if (p.exitCode!==null) { clearInterval(poll); clearTimeout(timer); } }, 50);
