import { randomUUID } from 'node:crypto';
import { createAIService } from './ai/service.js';
import { allowedFeature, publicAIStatus } from './ai/policies.js';
import { ASK_SCHEMA, validateAsk } from './ai/schemas.js';

export async function registerAI({ app, auth, q, tx, httpErr, root, env, rules }) {
  const service = await createAIService({ root, q, tx, env, rules });
  app.route({ method:'GET', url:'/api/ai/status', preHandler:auth('viewer'), handler:async()=>publicAIStatus(service.config) });
  app.route({ method:'GET', url:'/api/ai/audit', preHandler:auth('admin'), handler:async req=>{
    const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100);
    return (await q(`SELECT a.request_id,a.feature,a.provider,a.model,a.status,a.policy_decision,a.prompt_chars,a.input_tokens,a.output_tokens,a.cost_estimate_usd,a.duration_ms,a.fail_code,a.created_at,a.completed_at,u.username
      FROM ai_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT $1`,[limit])).rows;
  }});
  app.route({ method:'POST', url:'/api/ai/ask', preHandler:auth('viewer'), schema:{body:ASK_SCHEMA}, handler:async(req,reply)=>{
    const invalid=validateAsk(req.body); if(invalid) throw httpErr(400,invalid);
    if(!allowedFeature(req.user.role,req.body.feature)) throw httpErr(403,'role cannot use this AI feature');
    const requestId=randomUUID();
    try { return await service.ask(req.user,req.body,requestId,req.ip); }
    catch(error) {
      const code=String(error.code||'AI_REQUEST_FAILED');
      req.log.warn({request_id:requestId,code},'AI request blocked or failed');
      if(error.statusCode) throw httpErr(error.statusCode,error.message);
      throw httpErr(502,'تعذر إكمال طلب المساعد');
    }
  }});
  return service;
}
