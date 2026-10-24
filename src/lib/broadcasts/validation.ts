import { z } from 'zod';
import { CHANNELS, UUID } from './model';
export const templateSchema = z.object({
  name: z.string().trim().min(1,'Nama template wajib diisi.').max(80),
  title: z.string().trim().min(1,'Judul wajib diisi.').max(120).refine(v=>!/[\r\n]/.test(v),'Judul harus satu baris.'),
  body: z.string().trim().min(1,'Pesan wajib diisi.').max(3000),
  cta_label: z.string().trim().max(24).default(''),
  cta_url: z.string().trim().max(500).default(''),
}).strict().transform(data=>({ ...data, cta_url: data.cta_url.startsWith('/') && !data.cta_url.startsWith('//') ? 'https://axvara.tech'+data.cta_url : data.cta_url }))
.refine(data=>{
  if (!data.cta_url && !data.cta_label) return true;
  if (!data.cta_label || !data.cta_url) return false;
  try { const url=new URL(data.cta_url);return url.protocol==='https:' && !url.username && !url.password && !/[\r\n]/.test(data.cta_url); } catch { return false; }
},'Isi label dan tautan HTTPS tombol, atau kosongkan keduanya.');
export const targetSchema=z.object({templateId:z.string().regex(UUID),revision:z.number().int().positive(),channels:z.array(z.enum(CHANNELS)).min(1).max(3).refine(v=>new Set(v).size===v.length)}).strict();
