/**
 * Shared script for LangChain Chatbot
 */

// Global User Authentication Check
const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || 'null');

const checkAuth = () => {
  if (!currentUser && !window.location.pathname.endsWith('login.html') && window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
    window.location.href = '/';
  }
};

// Handle Logout
const handleLogout = () => {
  sessionStorage.removeItem('currentUser');
  window.location.href = '/';
};

// Toast notification helper
const showToast = (msg, type = 'success') => {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// HTML Escaping helper
const escapeHtml = (s) => (s + '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  const userBadge = document.getElementById('userBadge');
  if (userBadge && currentUser) {
    userBadge.textContent = `${currentUser.name} (${currentUser.email})`;
  }
});
