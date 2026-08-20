import { supabase, APP_CONFIG } from './supabase-client.js';
import { getCurrentUser } from './auth.js';
import { avatarFor, uploadImage, escapeHtml, filterProfanity, openUserProfile } from './profile.js';

const $ = id => document.getElementById(id);
let posts = [];
let replyTarget = null;

let page = 0;
const PAGE_SIZE = 10;
let isLoading = false;
let hasMore = true;

const notifySound = new Audio('https://etquvhtzwqzjskmkxlog.supabase.co/storage/v1/object/public/assets/audio/notification.mp3');

function playNotificationSound() {
  notifySound.currentTime = 0;
  notifySound.play().catch(err => console.log('Chờ tương tác để phát âm thanh:', err));
}

function toast(msg, type='') { window.appToast?.(msg, type); }

function timeAgo(iso) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(seconds / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày`;
  return new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(iso));
}

function fallbackAvatar(name='User') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e4eef8&color=24527a`;
}

async function loadPosts(reset = false) {
  if (isLoading || (!hasMore && !reset)) return;
  isLoading = true;

  if (reset) {
    page = 0;
    hasMore = true;
    posts = [];
    if ($('feed-list')) {
      $('feed-list').innerHTML = '<div style="text-align:center;padding:20px;color:#718096">Đang tải bảng tin...</div>';
    }
  }

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
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
      .range(from, to);

    if (error) throw error;

    const newPosts = data || [];
    if (newPosts.length < PAGE_SIZE) {
      hasMore = false;
    }

    posts = reset ? newPosts : [...posts, ...newPosts];
    page++;
    renderFeedList();
  } catch (err) {
    console.error('Lỗi tải bài viết:', err.message);
    toast(err.message, 'error');
  } finally {
    isLoading = false;
  }
}

function renderFeedList() {
  const container = $('feed-list');
  if (!container) return;

  if (!posts.length) {
    container.innerHTML = `<div class="card" style="padding:30px;text-align:center;color:#718096">Chưa có bài viết phù hợp.</div>`;
    return;
  }

  container.innerHTML = posts.map(postHtml).join('');

  if (!hasMore) {
    container.insertAdjacentHTML('beforeend', '<div style="text-align:center;padding:15px;color:#a0aec0;font-size:13px">Bạn đã xem hết bài viết.</div>');
  }
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
      <img class="avatar clickable-user" data-user-id="${user.id}" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="post-author">
        <strong class="clickable-user" data-user-id="${user.id}">${escapeHtml(user.full_name || 'User')}</strong>
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
      <img class="avatar clickable-user" data-user-id="${user.id}" style="width:32px;height:32px" src="${escapeHtml(user.avatar_url || fallbackAvatar(user.full_name))}" alt="">
      <div class="comment-body">
        <div class="comment-bubble">
          <strong class="clickable-user" data-user-id="${user.id}">${escapeHtml(user.full_name || 'User')}</strong>
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

function findPost(postId) { return posts.find(p => p.id === postId); }

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
  const content = filterProfanity(rawContent);
  const url = $('post-image-url').value.trim();
  const file = $('post-image').files[0];

  if (content.length > 280) {
    toast('Độ dài status không được quá 280 ký tự.', 'error');
    return;
  }

  if (!content && !url && !file) {
    toast('Bài viết cần nội dung hoặc ảnh.', 'error');
    return;
  }

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
    await loadPosts(true);
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
    await supabase.from('post_likes').delete().eq('id', existing.id);
  } else {
    await supabase.from('post_likes').insert({
      post_id: postId, user_id: user.id, reaction_type: 'like'
    });
  }
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
      <img class="avatar clickable-user" data-user-id="${p.id}" src="${escapeHtml(p.avatar_url || fallbackAvatar(p.full_name))}" alt="">
      <div class="person-info"><strong class="clickable-user" data-user-id="${p.id}">${escapeHtml(p.full_name)}</strong></div>
    </div>`).join('');
}

async function submitComment(event) {
  event.preventDefault(); // Chặn hành vi submit form mặc định gây load lại trang
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
  const content = filterProfanity(rawContent);

  // Lưu lại vị trí cuộn hiện tại của trang để tránh bị giật hoặc nhảy lên đầu
  const scrollPosition = window.scrollY;

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
    // Thay vì load lại toàn bộ feed làm mất vị trí, ta có thể giữ nguyên hoặc chỉ render nhẹ nhàng nếu cần, 
    // realtime từ supabase channel sẽ tự động cập nhật lại dữ liệu mà không làm giật trang.
  }
}

async function deleteComment(commentId) {
  if (!confirm('Xóa bình luận này và toàn bộ trả lời bên dưới?')) return;
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) toast(error.message, 'error');
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
}

async function deletePost(postId) {
  if (!confirm('Bạn chắc muốn xóa bài viết?')) return;
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) toast(error.message, 'error');
}

function handleFeedClick(event) {
  const userBtn = event.target.closest('.clickable-user');
  if (userBtn && userBtn.dataset.userId) {
    openUserProfile(userBtn.dataset.userId);
    return;
  }

  const postEl = event.target.closest('[data-post-id]');
  if (!postEl) return;
  const postId = postEl.dataset.postId;

  const actionBtn = event.target.closest('[data-action]');
  if (actionBtn) {
    event.preventDefault(); // Chặn nhảy trang
    const action = actionBtn.dataset.action;
    if (action === 'like') return togglePostLike(postId);
    if (action === 'likes') return showPostLikes(postId);
    if (action === 'focus-comment') {
      const input = postEl.querySelector('.comment-form input');
      if (input) input.focus();
      return;
    }
  }

  const commentEl = event.target.closest('[data-comment-id]');
  if (commentEl) {
    const commentId = commentEl.dataset.commentId;
    const cAction = event.target.closest('[data-comment-action]')?.dataset.commentAction;
    const comment = findPost(postId)?.comments?.find(c => c.id === commentId);
    
    if (cAction === 'like') return toggleCommentLike(commentId);
    if (cAction === 'reply') {
      replyTarget = { postId, commentId, name: comment?.profiles?.full_name || 'User' };
      renderFeedList();
      const input = postEl.querySelector('.comment-form input');
      if (input) input.focus();
      return;
    }
    if (cAction === 'delete') return deleteComment(commentId);
  }

  if (event.target.closest('.cancel-reply')) {
    replyTarget = null;
    renderFeedList();
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

function setupInfiniteScroll() {
  window.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadPosts(false);
    }
  });
}

// js/feed.js (Đoạn cập nhật ở cuối file)

export function initFeed() {
  if ($('post-form')) $('post-form').addEventListener('submit', submitPost);
  if ($('post-image')) $('post-image').addEventListener('change', previewPostImage);
  if ($('feed-list')) {
    $('feed-list').addEventListener('click', handleFeedClick);
    $('feed-list').addEventListener('submit', e => {
      if (e.target.closest('.comment-form')) {
        submitComment(e);
      }
    });
  }

  // Sự kiện click toàn cục cho danh sách Like
  $('likes-modal').addEventListener('click', e => {
    const userBtn = e.target.closest('.clickable-user');
    if (userBtn && userBtn.dataset.userId) {
      $('likes-modal').classList.add('hidden');
      openUserProfile(userBtn.dataset.userId);
    }
  });

  setupInfiniteScroll();

  window.addEventListener('auth-ready', () => loadPosts(true));
  window.addEventListener('profile-updated', () => loadPosts(true));

  // LẮNG NGHE REALTIME BẢNG TIN & THÔNG BÁO
  s// LẮNG NGHE REALTIME BẢNG TIN & THÔNG BÁO
  supabase.channel('feed-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => loadPosts(true))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_likes' }, payload => {
      const me = getCurrentUser();
      // Chỉ thông báo khi có người khác thích bài viết của chính bạn (hoặc bạn liên quan)
      // Lưu ý: Nếu muốn chính xác hơn, bạn có thể kiểm tra xem bài viết đó có thuộc về `me.id` hay không.
      if (me && payload.new && payload.new.user_id !== me.id) {
        playNotificationSound();
        toast('👍 Có người thích bài viết!', 'info');
      }
      loadPosts(true);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, payload => {
      const me = getCurrentUser();
      if (me && payload.new && payload.new.user_id !== me.id) {
        playNotificationSound();
        toast('💬 Có bình luận mới!', 'info');
      }
      loadPosts(true);
    })
    .subscribe();
}
