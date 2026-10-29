const BASE = 'https://api.musetoken.store/api/admin/';
const labels = { pending: '待付款', reported: '待核实到账', processing: '待交付', complete: '已完成', expired: '已超时' };
let session = '';
function request(path, data) {
  return new Promise((resolve, reject) => wx.request({ url: BASE + path, method: data === undefined ? 'GET' : 'POST', data, timeout: path === 'supplier-deliver' ? 90000 : 15000, header: { 'content-type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, success: res => { if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data); else reject(new Error(res.data?.message || `请求失败（${res.statusCode}）`)); }, fail: () => reject(new Error('网络连接失败，请检查网络；发货结果请先核查，避免重复采购。')) }));
}
function modal(title, content) { return new Promise(resolve => wx.showModal({ title, content, success: res => resolve(res.confirm), fail: () => resolve(false) })); }
Page({
  data: { loggedIn: false, password: '', busy: false, orders: [], summary: {}, message: '', sound: false, filter: '', history: null, contactId: '', contactText: '' },
  onLoad() { this.audio = wx.createInnerAudioContext(); this.audio.src = '/assets/new-order.mp3'; this.audio.onError(() => this.setData({ message: '提醒声音播放失败，请检查手机音量。' })); },
  onShow() { if (session) { this.refresh(); this.startTimer(); } },
  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); this.audio?.destroy(); session = ''; },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  startTimer() { this.stopTimer(); this.timer = setInterval(() => this.refresh(), 10000); },
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; },
  passwordInput(e) { this.setData({ password: e.detail.value }); },
  async login() { if (this.data.busy || !this.data.password) return; this.setData({ busy: true, message: '' }); try { const result = await request('mini-login', { password: this.data.password }); session = result.session; this.known = null; this.setData({ loggedIn: true, password: '' }); await this.refresh(); this.startTimer(); } catch (e) { this.setData({ message: e.message }); } finally { this.setData({ busy: false }); } },
  async logout() { try { await request('logout', {}); } catch (_) {} session = ''; this.stopTimer(); this.known = null; this.setData({ loggedIn: false, orders: [], summary: {}, history: null, message: '' }); },
  enableSound() { this.setData({ sound: true, message: '声音提醒已开启；小程序在前台时生效。' }); this.audio.stop(); this.audio.play(); },
  async refresh() { if (!session || this.loading) return; this.loading = true; try { const data = await request('orders?page=0'); const current = {}; let fresh = false; data.orders.forEach(o => { current[o.id] = o.status; if (this.known && (!this.known[o.id] || (o.status === 'reported' && this.known[o.id] !== 'reported'))) fresh = true; }); this.known = current; if (fresh && this.data.sound) { this.audio.stop(); this.audio.play(); } const orders = data.orders.map(o => ({ ...o, statusLabel: labels[o.status] || o.status, amount: (o.amountCents / 100).toFixed(2), date: new Date(o.createdAt).toLocaleString() })); this.setData({ orders, summary: data.summary, message: fresh ? '有新订单或新的付款反馈，请核实。' : '' }); } catch (e) { if (e.message === '请登录工作台') { session = ''; this.stopTimer(); this.setData({ loggedIn: false }); } this.setData({ message: e.message }); } finally { this.loading = false; } },
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.value }); },
  async confirmPaid(e) { const o = this.data.orders.find(x => x.id === e.currentTarget.dataset.id); if (!o || this.data.busy || !await modal('核实收款', `请先核对到账记录：订单 ${o.code}，金额 ¥${o.amount}。确认已收到款项？`)) return; await this.action('update', { id: o.id, action: 'confirm' }, '已确认收款'); },
  async deliver(e) { const o = this.data.orders.find(x => x.id === e.currentTarget.dataset.id); if (!o || this.data.busy || !await modal('确认发货', `确认已核实收款，向 ${o.target} 发货？Muse 账号优先使用已导入库存，库存不足时将采购。`)) return; await this.action('supplier-deliver', { id: o.id }, '发货邮件已提交发送'); },
  async completeToken(e) { const o = this.data.orders.find(x => x.id === e.currentTarget.dataset.id); if (!o || this.data.busy || !await modal('完成充值', `请确认已为邀请码 ${o.target} 完成充值。`)) return; await this.action('update', { id: o.id, action: 'complete', checked: true }, '订单已完成'); },
  async action(path, payload, success) { this.setData({ busy: true }); try { await request(path, payload); wx.showToast({ title: success, icon: 'none' }); await this.refresh(); return true; } catch (e) { await modal('操作未确认', e.message); await this.refresh(); return false; } finally { this.setData({ busy: false }); } },
  async history(e) { try { const data = await request('delivery-history?orderId=' + encodeURIComponent(e.currentTarget.dataset.id)); const content = data.history.map(x => (x.state === 'sent' ? '已发送' : '发送结果待核查') + '\n' + x.text).join('\n\n────\n\n') || (data.legacy ? '历史卡密及说明（非完整邮件）：\n' + data.legacy.card + '\n\n' + (data.legacy.instruction || '') : '暂无可查看的发货内容。'); this.setData({ history: content }); } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); } },
  closeHistory() { this.setData({ history: null }); },
  openContact(e) { this.setData({ contactId: e.currentTarget.dataset.id, contactText: '' }); },
  contactInput(e) { this.setData({ contactText: e.detail.value }); },
  closeContact() { this.setData({ contactId: '', contactText: '' }); },
  async sendContact() { if (!this.data.contactText.trim() || this.data.busy || !await modal('发送邮件', '确认向该订单客户发送这条消息？')) return; if (await this.action('contact-buyer', { id: this.data.contactId, message: this.data.contactText }, '邮件已提交发送')) this.closeContact(); },
});
