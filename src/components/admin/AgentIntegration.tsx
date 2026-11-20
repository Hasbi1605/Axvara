"use client";
import {useEffect,useState}from"react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { formatWibDateTime } from "@/lib/utils";
import { AsyncConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label } from "./ui";
const scopes=["context:read","articles:read","articles:write","articles:submit","articles:schedule","articles:publish","media:write","audit:read"];
type Token={id:number;name:string;token_prefix:string;scopes:string[];is_active:number;last_used_at?:string};
export function AgentIntegration(){
  const [revoke, setRevoke] = useState<Token | null>(null);
  const[tokens,setTokens]=useState<Token[]>([]),[name,setName]=useState(""),[selected,setSelected]=useState<string[]>(["context:read","articles:read","articles:write","articles:submit","media:write"]),[raw,setRaw]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const load=()=>fetch("/api/admin/agent-tokens").then(r=>r.json()).then(j=>setTokens(j.tokens??[]));
  useEffect(()=>{void load()},[]);
  const create=async()=>{setError(null);const r=await fetch("/api/admin/agent-tokens",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,scopes:selected})});const j=await r.json();if(!r.ok){setError(j.error);return}setRaw(j.token);setName("");void load()};
  return <section className="mt-4"><Card className="mt-5">
    <CardHeader><CardTitle>Integrasi Agent</CardTitle><CardDescription>Remote MCP: https://axvara.tech/mcp</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {raw&&<div role="status" className="rounded-md border border-admin-warning/25 bg-admin-warning/10 p-4"><p className="text-sm font-medium text-admin-warning">Simpan token ini sekarang. Token tidak ditampilkan lagi.</p><code className="mt-2 block break-all text-xs text-admin-fg">{raw}</code><Button variant="outline" size="sm" className="mt-3" onClick={()=>navigator.clipboard.writeText(raw)}><Copy aria-hidden="true" /> Salin token</Button></div>}
      <div className="grid gap-4">
        <div className="grid gap-2"><Label htmlFor="agent-token-name">Nama token</Label><Input id="agent-token-name" value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Agent Konten Harian"/></div>
        <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium text-admin-fg">Izin (scope)</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{scopes.map(s=><Label key={s} className="flex items-center gap-2 font-mono text-xs font-normal text-admin-muted"><Checkbox checked={selected.includes(s)} onCheckedChange={()=>setSelected(x=>x.includes(s)?x.filter(v=>v!==s):[...x,s])}/>{s}</Label>)}</div></fieldset>
        <Button onClick={create} disabled={!name.trim()||!selected.length} className="w-fit"><Plus aria-hidden="true" /> Buat token</Button>
        {error&&<p role="alert" className="text-sm text-admin-danger">{error}</p>}
      </div>
      <div className="space-y-2">{tokens.map(t=><div key={t.id} className="flex items-center gap-3 rounded-md border border-admin-border px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-admin-fg">{t.name} <code className="font-normal text-admin-muted">{t.token_prefix}…</code></p><p className="text-xs text-admin-muted">{t.scopes.join(", ")} · {t.last_used_at?`dipakai ${formatWibDateTime(t.last_used_at)??"—"}`:"belum digunakan"}</p></div>{t.is_active? <Button variant="outline" size="icon" aria-label={`Cabut token ${t.name}`} title="Cabut token" onClick={() => setRevoke(t)} className="text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger"><Trash2 aria-hidden="true" /></Button>:<Badge variant="secondary">Revoked</Badge>}</div>)}</div>
      {revoke && <AsyncConfirmDialog title="Cabut token?" description={`Token “${revoke.name}” tidak dapat digunakan lagi.`} confirmLabel="Cabut token" onClose={() => setRevoke(null)} onConfirm={async () => {
        const res = await fetch(`/api/admin/agent-tokens/${revoke.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Gagal mencabut token. Coba lagi.");
        setTokens(rows => rows.map(row => row.id === revoke.id ? { ...row, is_active: 0 } : row));
        void load().catch(() => {});
      }} />}
    </CardContent>
  </Card></section>}
