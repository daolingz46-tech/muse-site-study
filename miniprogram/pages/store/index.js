const BASE = 'https://api.musetoken.store';
const products = {
  muse: [{ id:'account', title:'Muse 成品账号 + 10亿 Token', price:12, detail:'24小时内仅保障首次登录，成功登录后质保失效；需美国 IP 登录并及时换绑邮箱。' }],
  token: [{id:'100',title:'100亿 Token',price:20.3},{id:'150',title:'150亿 Token',price:31.5},{id:'200',title:'200亿 Token',price:36.4},{id:'300',title:'300亿 Token',price:55.3}],
  gpt: [{id:'halfPriceAccountOneMonth',title:'GPT 一个月半价资格账号',price:15,detail:'资格期限1个月，不含 Plus 订阅，可换绑邮箱。'},{id:'halfPriceTopup',title:'GPT 一个月半价代充',price:75,detail:'需先拥有半价资格账号。'},{id:'philippinesTopup',title:'GPT 菲律宾正价代充',price:128,detail:'自助充值卡密。'},{id:'plusAccount',title:'GPT Plus 成品账号',price:20,detail:'购买后20分钟内检查；售后直接联系 692972690@qq.com，具体范围请先确认。'},{id:'plus15Day',title:'GPT Plus 老号 · 15天质保',price:72,detail:'剩余有效期约20–26天；勿换绑、改密码或2FA，售后联系 692972690@qq.com。'}]
};
const labels={pending:'待付款',reported:'待核实到账',processing:'已收款，处理中',complete:'已完成',expired:'已超时'};
function api(path,data) { return new Promise((resolve,reject)=>wx.request({url:BASE+'/api/'+path,method:data?'POST':'GET',data,header:{'Content-Type':'application/json'},timeout:15000,success:r=>r.statusCode>=200&&r.statusCode<300?resolve(r.data):reject(new Error(r.data?.message||'请求失败')),fail:()=>reject(new Error('无法连接商店，请检查网络和小程序合法域名设置。'))})); }
async function uuid(){ const c=await new Promise((resolve,reject)=>wx.getRandomValues({length:16,success:r=>resolve(r.randomValues),fail:()=>reject(new Error('无法安全生成订单编号，请重试。'))})); const b=Array.from(new Uint8Array(c)); b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128; const h=b.map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
Page({
 data:{category:'muse',plans:products.muse,selected:0,email:'',inviteCode:'',method:'wechat',accepted:false,eligible:false,busy:false,error:'',order:null,history:[],stock:{}},
 onLoad(){this.setData({history:wx.getStorageSync('store-orders')||[]});this.getStock();},
 async getStock(){try{let x=await api('availability');this.setData({stock:x.stock||{}})}catch(_){}},
 category(e){const category=e.currentTarget.dataset.category;this.setData({category,plans:products[category],selected:0,accepted:false,eligible:false,error:''});},
 select(e){this.setData({selected:Number(e.currentTarget.dataset.index),eligible:false,error:''});},
 input(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value});},
 method(e){this.setData({method:e.currentTarget.dataset.value});},
 agree(e){this.setData({accepted:e.detail.value.includes('yes')});},
 eligible(e){this.setData({eligible:e.detail.value.includes('yes')});},
 async create(){if(this.data.busy)return;const {category,plans,selected,email,inviteCode,method,accepted,eligible,stock}=this.data;const plan=plans[selected];if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))return this.setData({error:'请输入有效的收件邮箱。'});if(category==='token'&&!inviteCode.trim())return this.setData({error:'请填写账号邀请码。'});if(!accepted)return this.setData({error:'请先阅读并同意购买须知。'});if(plan.id==='halfPriceTopup'&&!eligible)return this.setData({error:'请确认账号已有半价资格。'});if(stock[category==='muse'?'museAccount':plan.id]===false)return this.setData({error:'商品暂时缺货，请选择其他商品。'});this.setData({busy:true,error:''});try{this.requestId ||= await uuid();const order=await api('orders',{requestId:this.requestId,product:category==='token'?'muse-token':category,planId:category==='muse'?undefined:plan.id,email:email.trim(),inviteCode:inviteCode.trim(),method,acceptedTerms:true,eligibleConfirmed:eligible});this.requestId='';this.save(order);this.setData({order});}catch(e){this.setData({error:e.message});}finally{this.setData({busy:false});}},
 save(order){order.statusLabel=labels[order.status]||order.status;const history=[order,...this.data.history.filter(o=>o.id!==order.id)].slice(0,20);wx.setStorageSync('store-orders',history);this.setData({history});},
 back(){this.setData({order:null,error:''});},
 copyCode(){wx.setClipboardData({data:this.data.order.code});},
 qr(){const order=this.data.order;wx.previewImage({urls:[BASE+order.qrImageUrl]});},
 async refresh(){const o=this.data.order;if(!o||this.data.busy)return;this.setData({busy:true,error:''});try{const n=await api('orders/lookup',{id:o.id,token:o.token});this.save(n);this.setData({order:n});}catch(e){this.setData({error:e.message})}finally{this.setData({busy:false})}},
 async report(){const o=this.data.order;if(!o||this.data.busy)return;const ok=await new Promise(resolve=>wx.showModal({title:'确认付款',content:'请确认已付款，且付款备注已填写订单码。店主核实到账后处理订单。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!ok)return;this.setData({busy:true,error:''});try{const n=await api('orders/report',{id:o.id,token:o.token,remarkConfirmed:true});this.save(n);this.setData({order:n});}catch(e){this.setData({error:e.message})}finally{this.setData({busy:false})}},
 openHistory(e){this.setData({order:this.data.history[Number(e.currentTarget.dataset.index)],error:''});this.refresh();},
 onPullDownRefresh(){(this.data.order?this.refresh():this.getStock()).finally(()=>wx.stopPullDownRefresh());}
});
