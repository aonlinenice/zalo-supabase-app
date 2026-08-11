import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';

const $ = id => document.getElementById(id);

// Danh sách từ cấm lọc tục tĩu
const BAD_WORDS = ['lồn', 'cặc', 'dâm', 'đụ', 'sex', 'nứng', 'đụ má'];

function filterProfanity(text = '') {
  if (!text) return text;
  let filtered = text;
  BAD_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '***');
  });
  return filtered;
}

function toast(msg, type='') { window.appToast?.(msg, type); }

function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}

function avatarFor(profile) {
  return profile?.avatar_url || fallbackAvatar(profile?.full_name || 'User');
}

async function uploadImage(file, bucket, folder) {
  if (!file) return null;
  const MAX_SIZE = 4 * 1024 * 1024;
  if (file.size > MAX_SIZE) throw new Error('Dung lượng ảnh tối đa cho phép là 4MB.');
  if (!file.type.startsWith('image/')) throw new Error('Chỉ chấp nhận file định dạng ảnh.');

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function loadMyProfile() {
  const user = getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) {
    toast(error.message, 'error');
    return null;
  }
  renderMyProfile(data);
  return data;
}

function renderMyProfile(profile) {
  if (!profile) return;
  const url = avatarFor(profile);
  $('me-card').innerHTML = `
    <img class="avatar clickable-user" data-user-id="${profile.id}" src="${escapeAttr(url)}" alt="">
    <div class="me-info">
      <strong class="clickable-user" data-user-id="${profile.id}">${escapeHtml(profile.full_name || 'User')}</strong>
      <span>${escapeHtml(profile.bio || 'Chưa có trạng thái')}</span>
    </div>`;
  $('composer-avatar').src = url;
}

// XEM HỒ SƠ NGƯỜI DÙNG KHÁC
async function openUserProfile(userId) {
  const currentUser = getCurrentUser();
  if (currentUser && currentUser.id === userId) {
    openProfileModal();
    return;
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) {
    toast('Không thể tải thông tin người dùng.', 'error');
    return;
  }

  $('user-view-avatar').src = avatarFor(data);
  $('user-view-name').textContent = data.full_name || 'User';
  $('user-view-email').textContent = data.email || '';
  $('user-view-bio').textContent = data.bio || 'Chưa có trạng thái / Bio.';
  
  const chatBtn = $('user-view-chat-btn');
  chatBtn.dataset.userId = data.id;

  $('user-profile-modal').classList.remove('hidden');
}

function openProfileModal() {
  $('profile-modal').classList.remove('hidden');
  loadMyProfile().then(profile => {
    if (!profile) return;
    $('profile-avatar-preview').src = avatarFor(profile);
    $('profile-name').value = profile.full_name || '';
    $('profile-bio').value = profile.bio || '';
  });
}

async function saveProfile(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const name = filterProfanity($('profile-name').value.trim());
  const bio = filterProfanity($('profile-bio').value.trim());
  const file = $('profile-avatar-file').files[0];

  if (!name) {
    toast('Họ tên không được để trống.', 'error');
    return;
  }

  try {
    let avatarUrl;
    if (file) avatarUrl = await uploadImage(file, APP_CONFIG.avatarBucket, user.id);

    const update = { full_name: name, bio };
    if (avatarUrl) update.avatar_url = avatarUrl;

    const { data, error } = await supabase.from('profiles')
      .update(update).eq('id', user.id).select().single();

    if (error) throw error;

    renderMyProfile(data);
    $('profile-avatar-preview').src = avatarFor(data);
    $('profile-avatar-file').value = '';
    $('profile-modal').classList.add('hidden');
    toast('Đã cập nhật hồ sơ thành công.', 'success');
    window.dispatchEvent(new CustomEvent('profile-updated', { detail: data }));
  } catch (err) {
    toast(err.message || 'Không thể cập nhật hồ sơ.', 'error');
  }
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value='') { return escapeHtml(value); }

export { avatarFor, fallbackAvatar, uploadImage, escapeHtml, filterProfanity, openUserProfile };

export function initProfile() {
  $('profile-btn').addEventListener('click', openProfileModal);
  $('profile-btn-side').addEventListener('click', openProfileModal);
  $('profile-form').addEventListener('submit', saveProfile);
  $('profile-avatar-file').addEventListener('change', () => {
    const file = $('profile-avatar-file').files[0];
    if (file) $('profile-avatar-preview').src = URL.createObjectURL(file);
  });
  
  $('user-view-chat-btn').addEventListener('click', (e) => {
    const targetUserId = e.target.dataset.userId;
    $('user-profile-modal').classList.add('hidden');
    window.dispatchEvent(new CustomEvent('start-direct-chat', { detail: { userId: targetUserId } }));
  });

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  window.addEventListener('auth-ready', loadMyProfile);
}
