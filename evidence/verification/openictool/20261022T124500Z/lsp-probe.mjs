import { spawn } from 'node:child_process';
const R = process.env.ROOT, CWD = process.env.WS;
const p = spawn('node', [R+'/packages/mpd-mcp-lsp/launch.mjs', R+'/packages/mpd-mcp-lsp/dist/cli.js', 'mcp'], {
  cwd: CWD, env: process.env, stdio: ['pipe','pipe','pipe'],
});
let buf=''; const out=[]; const tools=[];
p.stdout.on('data', d => { buf += d; let i; while ((i=buf.indexOf('\n'))>=0) { const l=buf.slice(0,i); buf=buf.slice(i+1); try { out.push(JSON.parse(l)); } catch {} } });
p.stderr.on('data', d => process.stderr.write('LSPWARN '+d));
const send = o => p.stdin.write(JSON.stringify(o)+'\n');
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'openictool',version:'1'}}});
const timer = setTimeout(() => { console.log('TIMEOUT frames', out.length); p.kill(); process.exit(0); }, 60000);
p.on('exit', (c,s) => { console.log('LSP EXIT', c, s); });
const onMsg = (m) => {
  if (m.id===1) { console.log('init', m.result?.protocolVersion, JSON.stringify(m.result?.serverInfo)); send({jsonrpc:'2.0',method:'notifications/initialized'}); send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}); }
  if (m.id===2) { const ts=m.result?.tools||[]; console.log('tools', ts.map(t=>t.name).join(',')); const d=ts.find(t=>t.name==='diagnostics'); console.log('diagnostics schema', JSON.stringify(d?.inputSchema)); send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'status',arguments:{}}}); }
  if (m.id===3) { console.log('status', JSON.stringify(m.result).slice(0,1800)); send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'diagnostics',arguments:{uri:'file://'+CWD+'/ic/adder.v'}}}); }
  if (m.id===4) { console.log('diagnostics', JSON.stringify(m.result).slice(0,1800)); clearTimeout(timer); p.kill(); }
};
const poll = setInterval(() => { while (out.length) onMsg(out.shift()); if (p.exitCode!==null) { clearInterval(poll); clearTimeout(timer); } }, 50);
