// js/profile.js
import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';

const $ = id => document.getElementById(id);

function toast(msg, type='') { window.appToast?.(msg, type); }

function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}

function avatarFor(profile) {
  return profile?.avatar_url || fallbackAvatar(profile?.full_name || 'User');
}

async function uploadImage(file, bucket, folder) {
  if (!file) return null;
  if (file.size > 6 * 1024 * 1024) throw new Error('Ảnh vượt quá 6MB.');
  if (!file.type.startsWith('image/')) throw new Error('Chỉ chấp nhận file ảnh.');

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
    <img class="avatar" src="${escapeAttr(url)}" alt="">
    <div class="me-info">
      <strong>${escapeHtml(profile.full_name || 'User')}</strong>
      <span>${escapeHtml(profile.bio || 'Chưa có trạng thái')}</span>
    </div>`;
  $('composer-avatar').src = url;
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

  const name = $('profile-name').value.trim();
  const bio = $('profile-bio').value.trim();
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
    toast('Đã cập nhật hồ sơ.', 'success');
    window.dispatchEvent(new CustomEvent('profile-updated', { detail: data }));
  } catch (err) {
    toast(err.message || 'Không thể cập nhật hồ sơ.', 'error');
  }
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value='') { return escapeHtml(value); }

export { avatarFor, fallbackAvatar, uploadImage, escapeHtml };

export function initProfile() {
  $('profile-btn').addEventListener('click', openProfileModal);
  $('profile-btn-side').addEventListener('click', openProfileModal);
  $('profile-form').addEventListener('submit', saveProfile);
  $('profile-avatar-file').addEventListener('change', () => {
    const file = $('profile-avatar-file').files[0];
    if (file) $('profile-avatar-preview').src = URL.createObjectURL(file);
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
