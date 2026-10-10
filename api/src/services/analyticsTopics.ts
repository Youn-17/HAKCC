import {randomUUID} from 'node:crypto';
import {supabase} from '../config/supabase';
import {ApiError} from '../middleware/errorHandler';
export interface AnalyticsTopic {id:string;title:string;terms:string[]}
export function validateTopics(raw:unknown):AnalyticsTopic[] {
  if(!Array.isArray(raw)||raw.length>12)throw new ApiError(400,'最多设置 12 个主题');
  const ids=new Set<string>();
  return raw.map(item=>{
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[-\w]{1,40}$/.test(item.id)||ids.has(item.id))throw new ApiError(400,'主题 ID 无效或重复');
    ids.add(item.id);
    if(typeof item.title!=='string'||!item.title.trim()||item.title.trim().length>60||!Array.isArray(item.terms)||item.terms.length>20)throw new ApiError(400,'每个主题需标题与最多 20 个关键词');
    const seen=new Set<string>(),terms:string[]=[];
    for(const rawTerm of item.terms){
      if(typeof rawTerm!=='string')throw new ApiError(400,'关键词无效');
      const term=rawTerm.trim();if(term.length<2||term.length>30)throw new ApiError(400,'关键词需 2–30 字');
      if(!seen.has(term.toLocaleLowerCase())){terms.push(term);seen.add(term.toLocaleLowerCase());}
    }
    if(!terms.length)throw new ApiError(400,'每个主题至少填写一个关键词');
    return {id:item.id,title:item.title.trim(),terms};
  });
}
function storageError(code:string|undefined,message:string):never {
  if(['42P01','PGRST205'].includes(code??''))throw new ApiError(503,'请先运行 087_space_analytics_topics.sql 数据库迁移');
  throw new ApiError(500,message);
}
export async function loadTopics(spaceId:string):Promise<{topics:AnalyticsTopic[];revision:string|null}> {
  const {data,error}=await supabase.from('space_analytics_topics').select('topics,revision').eq('space_id',spaceId).maybeSingle();
  if(error)storageError(error.code,error.message);
  return data?{topics:validateTopics(data.topics),revision:data.revision}:{topics:[],revision:null};
}
/** Compare revisions so two teachers cannot silently overwrite one another. Caller authorizes the space. */
export async function saveTopics(spaceId:string,userId:string,topics:AnalyticsTopic[],expectedRevision:string|null) {
  const revision=randomUUID();const row={space_id:spaceId,topics,revision,updated_by:userId,updated_at:new Date().toISOString()};
  const query=expectedRevision?supabase.from('space_analytics_topics').update(row).eq('space_id',spaceId).eq('revision',expectedRevision):supabase.from('space_analytics_topics').insert(row);
  const {data,error}=await query.select('revision').maybeSingle();
  if(error?.code==='23505'||(!error&&!data))throw new ApiError(409,'主题已被其他教师修改，请刷新后再保存');
  if(error)storageError(error.code,error.message);
  return {topics,revision:data!.revision as string};
}
