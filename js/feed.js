import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { avatarFor, uploadImage, escapeHtml, filterProfanity } from './profile.js';

const $ = id => document.getElementById(id);
let posts = [];
let replyTarget = null;

function toast(msg, type='') { window.appToast?.(msg, type); }

function timeAgo(iso) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày`;
  return new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(iso));
}

function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}

async function getVisiblePosts() {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      id, user_id, content, image_url, privacy, created_at,
      profiles (id, full_name, avatar_url),
      post_likes (id, user_id, reaction_type, created_at),
      comments (
        id, post_id, user_id, parent_id, content, created_at, updated_at,
        profiles (id, full_name, avatar_url),
        comment_likes (id, user_id)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    toast(error.message, 'error');
    return [];
  }
  return data || [];
}

function postHtml(post) {
  const user = post.profiles || {};
  const me = getCurrentUser();
  const likes = post.post_likes || [];
  const comments = post.comments || [];
  const liked = likes.some(x => x.user_id === me?.id);
  const image = post.image_url
    ? `<img class="post-image" src="${escapeHtml(post.image_url)}" alt="Ảnh bài viết" loading="lazy">`
    : '';

  return `<article class="post card" data-post-id="${post.id}">
    <div class="post-head">
      <img class="avatar" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="post-author">
        <strong>${escapeHtml(user.full_name || 'User')}</strong>
        <span>${timeAgo(post.created_at)} · ${privacyLabel(post.privacy)}</span>
      </div>
      ${me?.id === post.user_id ? `<button class="icon-btn delete-post" title="Xóa bài">⋮</button>` : ''}
    </div>
    ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ''}
    ${image}
    <div class="post-stats">
      <button class="stat-link likes-count" data-action="likes">${likes.length} lượt thích</button>
      <span>${comments.length} bình luận</span>
    </div>
    <div class="post-actions">
      <button class="post-action ${liked ? 'liked' : ''}" data-action="like">👍 ${liked ? 'Đã thích' : 'Thích'}</button>
      <button class="post-action" data-action="focus-comment">💬 Bình luận</button>
    </div>
    <div class="comments">
      <div class="comment-tree">${renderComments(post)}</div>
      ${renderReplyState(post.id)}
      <form class="comment-form" data-post-id="${post.id}">
        <input class="input" name="content" maxlength="1000" autocomplete="off" placeholder="${replyTarget?.postId === post.id ? `Trả lời ${replyTarget.name}...` : 'Viết bình luận...'}">
        <button class="btn primary" type="submit">Gửi</button>
      </form>
    </div>
  </article>`;
}

function privacyLabel(p) {
  return p === 'friends' ? 'Bạn bè' : p === 'private' ? 'Riêng tư' : 'Công khai';
}

function renderComments(post) {
  const comments = [...(post.comments || [])].sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
  const byParent = new Map();
  comments.forEach(c => {
    const key = c.parent_id || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  });

  const renderBranch = (parentId, depth=0) => (byParent.get(parentId) || []).map(c => {
    const user = c.profiles || {};
    const liked = (c.comment_likes || []).some(x => x.user_id === getCurrentUser()?.id);
    const canDelete = getCurrentUser()?.id === c.user_id || getCurrentUser()?.id === post.user_id;
    return `<div class="comment ${depth ? 'reply' : ''}" data-comment-id="${c.id}">
      <img class="avatar" style="width:32px;height:32px" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="comment-body">
        <div class="comment-bubble">
          <strong>${escapeHtml(user.full_name || 'User')}</strong>
          <p>${escapeHtml(c.content)}</p>
        </div>
        <div class="comment-tools">
          <button data-comment-action="like" class="${liked ? 'liked' : ''}">♥ ${(c.comment_likes || []).length}</button>
          <button data-comment-action="reply">Trả lời</button>
          ${canDelete ? '<button data-comment-action="delete">Xóa</button>' : ''}
          <span>${timeAgo(c.created_at)}</span>
        </div>
        ${renderBranch(c.id, depth + 1)}
      </div>
    </div>`;
  }).join('');

  return renderBranch('root');
}

function renderReplyState(postId) {
  if (!replyTarget || replyTarget.postId !== postId) return '';
  return `<div class="reply-state"><span>Đang trả lời <strong>${escapeHtml(replyTarget.name)}</strong></span><button type="button" class="cancel-reply">Hủy</button></div>`;
}

async function renderFeed() {
  posts = await getVisiblePosts();
  $('feed-list').innerHTML = posts.length
    ? posts.map(postHtml).join('')
    : `<div class="card" style="padding:30px;text-align:center;color:#718096">Chưa có bài viết phù hợp.</div>`;
}

function findPost(postId) { return posts.find(p => p.id === postId); }

// 1. GIỚI HẠN SỐ LƯỢNG STATUS (Tối đa 5 bài/ngày)
async function checkPostLimit(userId) {
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);

  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString());

  if (error) return true;
  return (count || 0) < 5;
}

async function submitPost(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const rawContent = $('post-content').value.trim();
  // 5. LỌC TỪ TỤC TĨU
  const content = filterProfanity(rawContent);
  const url = $('post-image-url').value.trim();
  const file = $('post-image').files[0];

  // 3. GIỚI HẠN ĐỘ DÀI KÝ TỰ STATUS (Dưới 280 ký tự)
  if (content.length > 280) {
    toast('Độ dài status không được quá 280 ký tự.', 'error');
    return;
  }

  if (!content && !url && !file) {
    toast('Bài viết cần nội dung hoặc ảnh.', 'error');
    return;
  }

  // KIỂM TRA GIỚI HẠN BÀI ĐĂNG
  const canPost = await checkPostLimit(user.id);
  if (!canPost) {
    toast('Bạn đã đạt giới hạn 5 bài đăng trong ngày hôm nay.', 'error');
    return;
  }

  try {
    let imageUrl = url || null;
    if (file) imageUrl = await uploadImage(file, APP_CONFIG.mediaBucket, user.id);

    const { error } = await supabase.from('posts').insert({
      user_id: user.id,
      content,
      image_url: imageUrl,
      privacy: $('post-privacy').value
    });
    if (error) throw error;

    event.target.reset();
    $('post-image-preview').classList.add('hidden');
    toast('Đã đăng bài.', 'success');
    await renderFeed();
  } catch (err) {
    toast(err.message || 'Không thể đăng bài.', 'error');
  }
}

async function togglePostLike(postId) {
  const user = getCurrentUser();
  const post = findPost(postId);
  if (!user || !post) return;

  const existing = (post.post_likes || []).find(x => x.user_id === user.id);
  if (existing) {
    const { error } = await supabase.from('post_likes').delete().eq('id', existing.id);
    if (error) toast(error.message, 'error');
  } else {
    const { error } = await supabase.from('post_likes').insert({
      post_id: postId, user_id: user.id, reaction_type: 'like'
    });
    if (error) toast(error.message, 'error');
  }
  await renderFeed();
}

async function showPostLikes(postId) {
  const post = findPost(postId);
  if (!post) return;
  const ids = [...new Set((post.post_likes || []).map(x => x.user_id))];
  $('likes-list').innerHTML = '<div style="color:#718096">Đang tải...</div>';
  $('likes-modal').classList.remove('hidden');

  if (!ids.length) {
    $('likes-list').innerHTML = '<div style="color:#718096;padding:10px">Chưa có lượt thích.</div>';
    return;
  }

  const { data, error } = await supabase.from('profiles').select('id,full_name,avatar_url').in('id', ids);
  if (error) {
    toast(error.message, 'error');
    return;
  }
  $('likes-list').innerHTML = (data || []).map(p => `
    <div class="person">
      <img class="avatar" src="${escapeHtml(p.avatar_url || fallbackAvatar(p.full_name))}" alt="">
      <div class="person-info"><strong>${escapeHtml(p.full_name)}</strong></div>
    </div>`).join('');
}

async function submitComment(event) {
  event.preventDefault();
  const user = getCurrentUser();
  const form = event.target.closest('form') || event.currentTarget;
  if (!form) return;

  const postId = form.dataset.postId;
  const inputEl = form.querySelector('input[name="content"]') || form.querySelector('input');
  const rawContent = inputEl ? inputEl.value.trim() : '';

  if (!user) {
    toast('Vui lòng đăng nhập để bình luận.', 'error');
    return;
  }

  if (!rawContent) return;
  // 5. LỌC TỪ TỤC TĨU TRONG BÌNH LUẬN
  const content = filterProfanity(rawContent);

  const { error } = await supabase.from('comments').insert({
    post_id: postId,
    user_id: user.id,
    parent_id: replyTarget?.postId === postId ? replyTarget.commentId : null,
    content
  });

  if (error) {
    toast(error.message, 'error');
  } else {
    replyTarget = null;
    form.reset();
    await renderFeed();
  }
}

async function deleteComment(commentId) {
  if (!confirm('Xóa bình luận này và toàn bộ trả lời bên dưới?')) return;
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) toast(error.message, 'error');
  else await renderFeed();
}

async function toggleCommentLike(commentId) {
  const user = getCurrentUser();
  if (!user) return;
  const post = posts.find(p => (p.comments || []).some(c => c.id === commentId));
  const comment = post?.comments?.find(c => c.id === commentId);
  if (!comment) return;

  const existing = (comment.comment_likes || []).find(x => x.user_id === user.id);
  const query = existing
    ? supabase.from('comment_likes').delete().eq('id', existing.id)
    : supabase.from('comment_likes').insert({ comment_id: commentId, user_id: user.id });

  const { error } = await query;
  if (error) toast(error.message, 'error');
  else await renderFeed();
}

async function deletePost(postId) {
  if (!confirm('Bạn chắc muốn xóa bài viết?')) return;
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) toast(error.message, 'error');
  else await renderFeed();
}

function handleFeedClick(event) {
  const postEl = event.target.closest('[data-post-id]');
  if (!postEl) return;
  const postId = postEl.dataset.postId;

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'like') return togglePostLike(postId);
  if (action === 'likes') return showPostLikes(postId);
  if (action === 'focus-comment') {
    postEl.querySelector('.comment-form input')?.focus();
    return;
  }

  const commentEl = event.target.closest('[data-comment-id]');
  if (commentEl) {
    const commentId = commentEl.dataset.commentId;
    const cAction = event.target.closest('[data-comment-action]')?.dataset.commentAction;
    const comment = findPost(postId)?.comments?.find(c => c.id === commentId);
    if (cAction === 'like') return toggleCommentLike(commentId);
    if (cAction === 'reply') {
      replyTarget = { postId, commentId, name: comment?.profiles?.full_name || 'User' };
      renderFeed();
      return;
    }
    if (cAction === 'delete') return deleteComment(commentId);
  }

  if (event.target.closest('.cancel-reply')) {
    replyTarget = null;
    renderFeed();
    return;
  }
  if (event.target.closest('.delete-post')) deletePost(postId);
}

function previewPostImage() {
  const file = $('post-image').files[0];
  if (!file) {
    $('post-image-preview').classList.add('hidden');
    return;
  }
  const url = URL.createObjectURL(file);
  $('post-image-preview').innerHTML = `<img src="${url}" alt="Preview">`;
  $('post-image-preview').classList.remove('hidden');
}

export function initFeed() {
  $('post-form').addEventListener('submit', submitPost);
  $('post-image').addEventListener('change', previewPostImage);
  $('feed-list').addEventListener('click', handleFeedClick);
  $('feed-list').addEventListener('submit', e => {
    if (e.target.closest('.comment-form')) {
      submitComment(e);
    }
  });
  window.addEventListener('auth-ready', renderFeed);
  window.addEventListener('profile-updated', renderFeed);

  // 6. THÔNG BÁO KHI CÓ BÌNH LUẬN MỚI
  supabase.channel('feed-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, renderFeed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, renderFeed)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, payload => {
      const me = getCurrentUser();
      if (me && payload.new.user_id !== me.id) {
        toast('💬 Có bình luận mới trên bảng tin!', 'info');
      }
      renderFeed();
    })
    .subscribe();
}
