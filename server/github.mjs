import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ApiError,validateEnvelope,validateState} from './validation.mjs';
export const REPO='usukura-P/conversion-design-q3-2026';
export const BRANCH='codex/3q-dashboard';
export const STATE_PATH='data/state.json';
const ROOT=`https://api.github.com/repos/${REPO}`;
const digest=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
export class GitHubStore {
 constructor({token=process.env.GITHUB_TOKEN,fetchImpl=globalThis.fetch}={}){this.token=token;this.fetch=fetchImpl;}
 async api(path,options={}){
  if(!this.token)throw new ApiError(503,'保存サーバーの設定が未完了です');
  let response;try{response=await this.fetch(`${ROOT}${path}`,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'q3-progress-api','Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw new ApiError(502,'GitHubへ接続できません。下書きを残して再試行してください');}
  if(!response.ok){if([409,422].includes(response.status)&&options.method==='PUT')throw new ApiError(409,'別の更新が保存されています。最新を読み込み、下書きと照合してください');throw new ApiError(502,'GitHubでの読み込み・保存に失敗しました。下書きは保持してください');}
  try{return await response.json();}catch{throw new ApiError(502,'GitHubの応答を確認できませんでした');}
 }
 async get(ref=BRANCH){const file=await this.api(`/contents/${STATE_PATH}?ref=${encodeURIComponent(ref)}&t=${Date.now()}`);if(file.encoding!=='base64'||typeof file.content!=='string'||!/^[a-f0-9]{40}$/.test(file.sha))throw new ApiError(502,'GitHubのデータ形式を確認できません');let state;try{state=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));validateState(state);}catch{throw new ApiError(502,'保存済みデータに不整合があります。Git履歴を確認してください');}return {state,revision:file.sha};}
 async receipt(requestId){
  // Git commit history is the durable deduplication ledger: retained across restarts
  // and shared across service instances. Never truncate it and accidentally replay.
  for(let page=1;;page++){const commits=await this.api(`/commits?sha=${encodeURIComponent(BRANCH)}&path=${encodeURIComponent(STATE_PATH)}&per_page=100&page=${page}`);if(!Array.isArray(commits))throw new ApiError(502,'保存履歴を確認できません');for(const c of commits){const match=c.commit?.message?.match(/\nQ3-Request: ([0-9a-f-]+) ([0-9a-f]{64})(?:\n|$)/i);if(match&&match[1]===requestId)return {hash:match[2],commitUrl:c.html_url};}if(commits.length<100)return null;}
 }
 async save(body){
  validateEnvelope(body);const hash=digest(body),prior=await this.receipt(body.requestId),current=await this.get();
  if(prior){if(prior.hash!==hash)throw new ApiError(409,'この保存IDは別の内容です。最新を読み込み、新しい保存として実行してください');return {...current,commitUrl:prior.commitUrl,updatedAt:current.state.updatedAt,deduplicated:true};}
  if(current.revision!==body.revision)throw new ApiError(409,'他の人が更新しました。下書きを残して最新を読み込んでください');
  validateState(body.state,current.state.baseline);
  const state=structuredClone(body.state);state.updatedAt=new Date().toISOString();
  const saved=await this.api(`/contents/${STATE_PATH}`,{method:'PUT',body:JSON.stringify({branch:BRANCH,sha:current.revision,message:`週次の進捗を共有するため更新（${body.editor.replace(/[\r\n]/g,' ')}）\n\nQ3-Request: ${body.requestId} ${hash}\n`,content:Buffer.from(JSON.stringify(state,null,2)+'\n').toString('base64')})});
  // Verify the precise commit, not mutable branch HEAD which another editor may advance.
  const verified=await this.get(saved.commit.sha);
  if(verified.revision!==saved.content.sha||!isDeepStrictEqual(verified.state,state))throw new ApiError(502,'保存後の確認が完了しませんでした。同じ保存内容で再試行してください');
  return {...verified,commitUrl:saved.commit.html_url,updatedAt:state.updatedAt};
 }
}
