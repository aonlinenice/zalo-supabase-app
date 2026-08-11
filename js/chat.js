import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { avatarFor, uploadImage, escapeHtml, filterProfanity } from './profile.js';

const $ = id => document.getElementById(id);
let conversations = [];
let activeConversation = null;
let activeMembers = [];
let messages = [];
let replyMessage = null;
let chatChannel = null;
let selectedGroupUsers = [];

function toast(msg, type='') { window.appToast?.(msg, type); }
function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}
function timeShort(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
  }
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
}
function debounce(fn, ms=250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

async function loadConversations() {
  const user = getCurrentUser();
  if (!user) return;

  const { data, error } = await supabase
    .from('conversation_members')
    .select(`
      conversation_id, role, status, joined_at,
      conversations (
        id, type, name, avatar_url, created_by, created_at,
        conversation_members (
          user_id, role, status,
          profiles (id, full_name, avatar_url)
        ),
        messages (id, content, media_url, is_recalled, created_at, sender_id)
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) {
    toast(error.message, 'error');
    return;
  }

  conversations = (data || []).map(x => x.conversations).filter(Boolean).map(c => {
    c.conversation_members = (c.conversation_members || []).filter(m => m.status === 'active');
    c.messages = (c.messages || []).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    return c;
  }).sort((a,b) => {
    const at = a.messages.at(-1)?.created_at || a.created_at;
    const bt = b.messages.at(-1)?.created_at || b.created_at;
    return new Date(bt) - new Date(at);
  });

  renderConversationList();
  if (activeConversation) {
    const fresh = conversations.find(c => c.id === activeConversation.id);
    if (fresh) {
      activeConversation = fresh;
      renderChatHeader();
    }
  }
}

function conversationDisplay(c) {
  const me = getCurrentUser();
  if (c.type === 'group') {
    return { name: c.name || 'Nhóm không tên', avatar: c.avatar_url || fallbackAvatar(c.name || 'Group'), subtitle: `${c.conversation_members.length} thành viên` };
  }
  const other = c.conversation_members.find(m => m.user_id !== me?.id)?.profiles;
  return { name: other?.full_name || 'Người dùng', avatar: other?.avatar_url || fallbackAvatar(other?.full_name), subtitle: 'Trò chuyện riêng' };
}

function renderConversationList() {
  $('chat-list').innerHTML = conversations.length ? conversations.map(c => {
    const d = conversationDisplay(c);
    const last = c.messages.at(-1);
    const preview = last ? (last.is_recalled ? 'Tin nhắn đã được thu hồi' : (last.content || '📷 Ảnh')) : 'Chưa có tin nhắn';
    return `<button class="chat-list-item ${activeConversation?.id === c.id ? 'active' : ''}" data-conversation-id="${c.id}">
      <img class="avatar" src="${escapeHtml(d.avatar)}" alt="">
      <div class="chat-preview">
        <strong>${escapeHtml(d.name)}</strong>
        <span>${escapeHtml(preview)} · ${last ? timeShort(last.created_at) : ''}</span>
      </div>
    </button>`;
  }).join('') : `<div style="padding:10px;color:#718096;font-size:12px">Chưa có cuộc trò chuyện.</div>`;
}

async function openConversation(id) {
  const c = conversations.find(x => x.id === id);
  if (!c) return;
  activeConversation = c;
  replyMessage = null;
  $('chat-empty').classList.add('hidden');
  $('chat-panel').classList.remove('hidden');
  renderConversationList();
  await loadMembers();
  await loadMessages();
  renderChatHeader();
  subscribeConversation();
}

async function loadMembers() {
  if (!activeConversation) return;
  const { data, error } = await supabase
    .from('conversation_members')
    .select('id, user_id, role, status, joined_at, profiles (id, full_name, avatar_url, email)')
    .eq('conversation_id', activeConversation.id)
    .order('joined_at', { ascending: true });

  if (error) toast(error.message, 'error');
  activeMembers = data || [];
}

async function loadMessages() {
  if (!activeConversation) return;
  const { data, error } = await supabase.from('messages')
    .select(`
      id, conversation_id, sender_id, content, media_url, reply_to_id, is_recalled, created_at,
      profiles (id, full_name, avatar_url),
      reply_to:messages!reply_to_id (id, sender_id, content, is_recalled, created_at)
    `)
    .eq('conversation_id', activeConversation.id)
    .order('created_at', { ascending: true })
    .limit(300);

  if (error) {
    toast(error.message, 'error');
    return;
  }
  messages = data || [];
  await loadReactions();
  renderMessages();
}

async function loadReactions() {
  if (!messages.length) return;
  const ids = messages.map(m => m.id);
  const { data, error } = await supabase.from('message_reactions')
    .select('id, message_id, user_id, emoji')
    .in('message_id', ids);
  if (error) return;
  const map = new Map();
  (data || []).forEach(r => {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push(r);
  });
  messages.forEach(m => m.reactions = map.get(m.id) || []);
}

function renderChatHeader() {
  const d = conversationDisplay(activeConversation);
  $('chat-avatar').src = d.avatar;
  $('chat-title').textContent = d.name;
  $('chat-subtitle').textContent = d.subtitle;
  $('group-info-btn').classList.toggle('hidden', activeConversation.type !== 'group');
}

function renderMessages() {
  const me = getCurrentUser();
  $('message-list').innerHTML = messages.map(m => {
    const mine = m.sender_id === me?.id;
    const sender = m.profiles || {};
    const quote = m.reply_to ? `<div class="quote">↪ ${escapeHtml(m.reply_to.content || 'Tin nhắn đã thu hồi')}</div>` : '';
    const body = m.is_recalled
      ? `<div class="recalled">Tin nhắn đã được thu hồi</div>`
      : `${quote}${m.content ? `<div class="message-text">${escapeHtml(m.content)}</div>` : ''}${m.media_url ? `<img class="message-media" src="${escapeHtml(m.media_url)}" alt="Ảnh" loading="lazy">` : ''}`;

    const reactions = (m.reactions || []).map(r => `<span class="reaction-chip">${escapeHtml(r.emoji)}</span>`).join('');
    return `<div class="message-row ${mine ? 'mine' : ''}" data-message-id="${m.id}">
      ${!mine ? `<img class="avatar" style="width:30px;height:30px" src="${escapeHtml(sender.avatar_url || fallbackAvatar(sender.full_name))}" alt="">` : ''}
      <div>
        ${!mine && activeConversation.type === 'group' ? `<div class="message-sender">${escapeHtml(sender.full_name || 'User')}</div>` : ''}
        <div class="message-bubble">
          ${body}
          <div class="message-time">${timeShort(m.created_at)}</div>
        </div>
        <div class="message-tools">
          <button data-message-action="reply">↩ Trả lời</button>
          <button data-message-action="react" data-emoji="❤️">❤️</button>
          <button data-message-action="react" data-emoji="👍">👍</button>
          <button data-message-action="react" data-emoji="😂">😂</button>
          ${mine && !m.is_recalled ? '<button data-message-action="recall">Thu hồi</button>' : ''}
        </div>
        <div class="reaction-strip">${reactions}</div>
      </div>
    </div>`;
  }).join('');
  $('message-list').scrollTop = $('message-list').scrollHeight;
}

function setReplyMessage(m) {
  replyMessage = m;
  $('reply-banner').classList.remove('hidden');
  $('reply-text').textContent = m.is_recalled ? 'Tin nhắn đã được thu hồi' : (m.content || 'Ảnh');
  $('message-input').focus();
}
function cancelReply() {
  replyMessage = null;
  $('reply-banner').classList.add('hidden');
}

async function sendMessage(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user || !activeConversation) return;

  const rawContent = $('message-input').value.trim();
  // 5. LỌC TỪ TỤC TĨU TRONG CHAT
  const content = filterProfanity(rawContent);
  const file = $('message-media').files[0];
  if (!content && !file) return;

  try {
    let mediaUrl = null;
    // 2. DUNG LƯỢNG ÁNH ĐÃ ĐƯỢC ÉP TẠI uploadImage (4MB)
    if (file) mediaUrl = await uploadImage(file, APP_CONFIG.mediaBucket, user.id);

    const { error } = await supabase.from('messages').insert({
      conversation_id: activeConversation.id,
      sender_id: user.id,
      content,
      media_url: mediaUrl,
      reply_to_id: replyMessage?.id || null
    });
    if (error) throw error;

    event.target.reset();
    cancelReply();
  } catch (err) {
    toast(err.message || 'Không thể gửi tin nhắn.', 'error');
  }
}

async function recallMessage(id) {
  const message = messages.find(m => m.id === id);
  if (!message || message.sender_id !== getCurrentUser()?.id) return;
  if (!confirm('Thu hồi tin nhắn này?')) return;

  const { error } = await supabase.from('messages').update({ is_recalled: true }).eq('id', id).eq('sender_id', getCurrentUser().id);
  if (error) toast(error.message, 'error');
}

async function toggleReaction(messageId, emoji) {
  const user = getCurrentUser();
  const message = messages.find(m => m.id === messageId);
  if (!user || !message) return;

  const existing = (message.reactions || []).find(r => r.user_id === user.id);
  if (existing && existing.emoji === emoji) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
    if (error) toast(error.message, 'error');
  } else if (existing) {
    const { error } = await supabase.from('message_reactions').update({ emoji }).eq('id', existing.id);
    if (error) toast(error.message, 'error');
  } else {
    const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    if (error) toast(error.message, 'error');
  }
}

function subscribeConversation() {
  if (chatChannel) supabase.removeChannel(chatChannel);
  if (!activeConversation) return;

  chatChannel = supabase
    .channel(`conversation-${activeConversation.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${activeConversation.id}`
    }, async payload => {
      await loadMessages();
      await loadConversations();
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'message_reactions'
    }, async payload => {
      const msgId = payload.new?.message_id || payload.old?.message_id;
      if (msgId && messages.some(m => m.id === msgId)) {
        await loadMessages();
      }
    })
    .subscribe();
}

// 4. CHỌN NGƯỜI TRÒ CHUYỆN / TẠO NHÓM
async function searchUsers(term, target='direct') {
  const user = getCurrentUser();
  if (!user) return;

  let query = supabase.from('profiles').select('id, full_name, email, avatar_url').neq('id', user.id).order('full_name').limit(20);
  if (term.trim()) {
    const safe = term.trim().replace(/[%_]/g, '');
    query = query.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) {
    toast(error.message, 'error');
    return;
  }
  const html = (data || []).map(p => `
    <div class="person">
      <img class="avatar" src="${escapeHtml(p.avatar_url || fallbackAvatar(p.full_name))}" alt="">
      <div class="person-info"><strong>${escapeHtml(p.full_name)}</strong><span>${escapeHtml(p.email || '')}</span></div>
      ${target === 'direct'
        ? `<button class="person-action" data-user-id="${p.id}" data-action="start-direct">Chat</button>`
        : `<button class="person-action" data-user-id="${p.id}" data-action="select-group">${selectedGroupUsers.some(x => x.id === p.id) ? 'Bỏ chọn' : 'Chọn'}</button>`}
    </div>`).join('');

  $(target === 'direct' ? 'user-search-results' : 'group-results').innerHTML =
    html || '<div style="padding:10px;color:#718096">Không tìm thấy người dùng.</div>';
}

async function startDirect(userId) {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { p_other_user_id: userId });
  if (error) {
    toast(error.message, 'error');
    return;
  }
  closeModal('new-chat-modal');
  await loadConversations();
  await openConversation(data);
  showView('chat-view');
}

function selectGroupUser(userId) {
  const person = [...document.querySelectorAll('#group-results .person')].find(x => x.querySelector('[data-user-id]')?.dataset.userId === userId);
  if (!person) return;
  const name = person.querySelector('.person-info strong')?.textContent || 'User';
  const avatar = person.querySelector('.avatar')?.src || '';

  const idx = selectedGroupUsers.findIndex(x => x.id === userId);
  if (idx >= 0) selectedGroupUsers.splice(idx, 1);
  else selectedGroupUsers.push({ id:userId, name, avatar });

  renderSelectedGroup();
  searchUsers($('group-search').value, 'group');
}

function renderSelectedGroup() {
  $('group-selected').innerHTML = selectedGroupUsers.map(p => `
    <span class="chip">${escapeHtml(p.name)} <button data-remove-group-user="${p.id}">×</button></span>`).join('');
}

async function createGroup() {
  const user = getCurrentUser();
  const rawName = $('group-name').value.trim();
  const name = filterProfanity(rawName);

  if (!user || !name) {
    toast('Hãy nhập tên nhóm.', 'error');
    return;
  }
  if (selectedGroupUsers.length < 1) {
    toast('Chọn ít nhất một thành viên.', 'error');
    return;
  }

  const { data: conversation, error } = await supabase.from('conversations')
    .insert({ type:'group', name, created_by:user.id })
    .select().single();
  if (error) {
    toast(error.message, 'error');
    return;
  }

  const members = [
    { conversation_id:conversation.id, user_id:user.id, role:'admin', status:'active' },
    ...selectedGroupUsers.map(p => ({ conversation_id:conversation.id, user_id:p.id, role:'member', status:'active' }))
  ];

  const { error: memberError } = await supabase.from('conversation_members').insert(members);
  if (memberError) {
    await supabase.from('conversations').delete().eq('id', conversation.id);
    toast(memberError.message, 'error');
    return;
  }

  selectedGroupUsers = [];
  $('group-name').value = '';
  renderSelectedGroup();
  closeModal('new-chat-modal');
  await loadConversations();
  await openConversation(conversation.id);
  showView('chat-view');
}

async function openGroupModal() {
  if (!activeConversation || activeConversation.type !== 'group') return;
  await loadMembers();
  $('edit-group-name').value = activeConversation.name || '';
  $('group-members-list').innerHTML = activeMembers.map(m => {
    const p = m.profiles || {};
    const isMe = m.user_id === getCurrentUser()?.id;
    const canManage = activeMembers.find(x => x.user_id === getCurrentUser()?.id)?.role === 'admin'
      || activeMembers.find(x => x.user_id === getCurrentUser()?.id)?.role === 'co_admin';
    const roleLabel = m.role === 'admin' ? 'Trưởng nhóm' : m.role === 'co_admin' ? 'Phó nhóm' : 'Thành viên';
    return `<div class="person">
      <img class="avatar" src="${escapeHtml(p.avatar_url || fallbackAvatar(p.full_name))}" alt="">
      <div class="person-info"><strong>${escapeHtml(p.full_name || 'User')}</strong><span>${roleLabel}</span></div>
      ${canManage && !isMe && m.role !== 'admin' ? `<button class="person-action" data-remove-member="${m.user_id}">Xóa</button>` : ''}
    </div>`;
  }).join('');
  $('group-modal').classList.remove('hidden');
}

async function saveGroupName() {
  const user = getCurrentUser();
  const name = filterProfanity($('edit-group-name').value.trim());
  if (!user || !activeConversation || !name) return;

  const me = activeMembers.find(m => m.user_id === user.id);
  if (!me || !['admin','co_admin'].includes(me.role)) {
    toast('Bạn không có quyền đổi tên nhóm.', 'error');
    return;
  }

  const { error } = await supabase.from('conversations').update({ name }).eq('id', activeConversation.id);
  if (error) toast(error.message, 'error');
  else {
    closeModal('group-modal');
    await loadConversations();
    activeConversation = conversations.find(c => c.id === activeConversation.id) || activeConversation;
    renderChatHeader();
  }
}

async function removeMember(userId) {
  if (!activeConversation) return;
  const me = activeMembers.find(m => m.user_id === getCurrentUser()?.id);
  if (!me || !['admin','co_admin'].includes(me.role)) return;

  const target = activeMembers.find(m => m.user_id === userId);
  if (!target || target.role === 'admin') return;

  if (!confirm(`Xóa ${target.profiles?.full_name || 'thành viên'} khỏi nhóm?`)) return;
  const { error } = await supabase.from('conversation_members').delete()
    .eq('conversation_id', activeConversation.id).eq('user_id', userId);
  if (error) toast(error.message, 'error');
  else openGroupModal();
}

async function dissolveGroup() {
  if (!activeConversation || activeConversation.type !== 'group') return;
  const me = activeMembers.find(m => m.user_id === getCurrentUser()?.id);
  if (!me || me.role !== 'admin') {
    toast('Chỉ Trưởng nhóm mới có thể giải tán nhóm.', 'error');
    return;
  }
  if (!confirm('Giải tán nhóm và xóa toàn bộ tin nhắn?')) return;

  const { error } = await supabase.from('conversations').delete().eq('id', activeConversation.id);
  if (error) toast(error.message, 'error');
  else {
    closeModal('group-modal');
    activeConversation = null;
    messages = [];
    if (chatChannel) supabase.removeChannel(chatChannel);
    $('chat-panel').classList.add('hidden');
    $('chat-empty').classList.remove('hidden');
    await loadConversations();
  }
}

function closeModal(id) { $(id).classList.add('hidden'); }

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    $(tab.dataset.tab).classList.remove('hidden');
  }));
}

export function initChat() {
  $('new-chat-btn').addEventListener('click', () => {
    selectedGroupUsers = [];
    renderSelectedGroup();
    $('new-chat-modal').classList.remove('hidden');
    searchUsers('', 'direct');
  });

  $('chat-list').addEventListener('click', e => {
    const item = e.target.closest('[data-conversation-id]');
    if (item) {
      openConversation(item.dataset.conversationId);
      showView('chat-view');
    }
  });

  $('message-form').addEventListener('submit', sendMessage);
  $('cancel-reply').addEventListener('click', cancelReply);
  $('mobile-chat-back').addEventListener('click', () => showView('feed-view'));

  $('message-list').addEventListener('click', e => {
    const row = e.target.closest('[data-message-id]');
    const button = e.target.closest('[data-message-action]');
    if (!row || !button) return;
    const message = messages.find(m => m.id === row.dataset.messageId);
    if (!message) return;

    const action = button.dataset.messageAction;
    if (action === 'reply') setReplyMessage(message);
    if (action === 'recall') recallMessage(message.id);
    if (action === 'react') toggleReaction(message.id, button.dataset.emoji);
  });

  $('user-search').addEventListener('input', debounce(e => searchUsers(e.target.value, 'direct')));
  $('group-search').addEventListener('input', debounce(e => searchUsers(e.target.value, 'group')));
  $('user-search-results').addEventListener('click', e => {
    const b = e.target.closest('[data-action="start-direct"]');
    if (b) startDirect(b.dataset.userId);
  });
  $('group-results').addEventListener('click', e => {
    const b = e.target.closest('[data-action="select-group"]');
    if (b) selectGroupUser(b.dataset.userId);
  });
  $('group-selected').addEventListener('click', e => {
    const b = e.target.closest('[data-remove-group-user]');
    if (b) {
      selectedGroupUsers = selectedGroupUsers.filter(x => x.id !== b.dataset.removeGroupUser);
      renderSelectedGroup();
      searchUsers($('group-search').value, 'group');
    }
  });
  $('create-group-btn').addEventListener('click', createGroup);
  $('group-info-btn').addEventListener('click', openGroupModal);
  $('save-group-name').addEventListener('click', saveGroupName);
  $('group-members-list').addEventListener('click', e => {
    const b = e.target.closest('[data-remove-member]');
    if (b) removeMember(b.dataset.removeMember);
  });
  $('dissolve-group-btn').addEventListener('click', dissolveGroup);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  setupTabs();

  window.addEventListener('auth-ready', async () => {
    await loadConversations();
    showView('feed-view');
  });
  window.addEventListener('auth-signed-out', () => {
    conversations = [];
    activeConversation = null;
    if (chatChannel) supabase.removeChannel(chatChannel);
  });

  // 6. THÔNG BÁO KHI CÓ TIN NHẮN MỚI REALTIME
  supabase.channel('chat-list-live')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const me = getCurrentUser();
      if (me && payload.new.sender_id !== me.id) {
        toast('📩 Bạn có tin nhắn mới!', 'info');
      }
      loadConversations();
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'conversation_members' }, loadConversations)
    .on('postgres_changes', { event:'*', schema:'public', table:'conversations' }, loadConversations)
    .subscribe();
}
