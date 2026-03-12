/* ══════════════════════════════════════════════════════════
   DURIO — Shared JavaScript
   ══════════════════════════════════════════════════════════ */

/* ─── Reveal on scroll ─────────────────────────────────────── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ─── Toast helper ─────────────────────────────────────────── */
function showToast(msg, icon = '✅') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span style="font-size:18px">${icon}</span> ${msg}`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ─── Category tab switching ───────────────────────────────── */
document.querySelectorAll('.cat-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    tab.closest('.cat-tabs').querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

/* ─── Wishlist toggle ──────────────────────────────────────── */
document.querySelectorAll('.wish-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = btn.classList.toggle('active');
    btn.textContent = isActive ? '❤️' : '🤍';
    showToast(isActive ? 'Added to wishlist!' : 'Removed from wishlist', isActive ? '❤️' : '🤍');
  });
});

/* ─── Add to cart ──────────────────────────────────────────── */
let cartCount = 3;
document.querySelectorAll('.add-cart-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    cartCount++;
    document.querySelectorAll('.badge-dot').forEach(b => b.textContent = cartCount);
    showToast('Added to cart!', '🛒');
    // Animate button
    btn.textContent = '✓ Added';
    btn.style.background = '#1A5C2A';
    setTimeout(() => {
      btn.textContent = btn.dataset.label || 'Add to Cart';
      btn.style.background = '';
    }, 2000);
  });
});

/* ─── Quantity selector ────────────────────────────────────── */
document.querySelectorAll('.qty-minus').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.closest('.qty-control').querySelector('.qty-input');
    if (parseInt(input.value) > 1) input.value = parseInt(input.value) - 1;
    updateCartTotal();
  });
});
document.querySelectorAll('.qty-plus').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.closest('.qty-control').querySelector('.qty-input');
    input.value = parseInt(input.value) + 1;
    updateCartTotal();
  });
});
function updateCartTotal() {
  const items = document.querySelectorAll('.cart-item');
  let total = 0;
  items.forEach(item => {
    const qty = parseInt(item.querySelector('.qty-input')?.value || 0);
    const price = parseFloat(item.dataset.price || 0);
    total += qty * price;
  });
  const totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = 'Rp ' + total.toLocaleString('id-ID');
}

/* ─── Remove cart item ─────────────────────────────────────── */
document.querySelectorAll('.remove-item').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.cart-item').style.animation = 'fadeOut .3s ease forwards';
    setTimeout(() => { btn.closest('.cart-item').remove(); updateCartTotal(); }, 300);
  });
});

/* ─── NavLink active state ─────────────────────────────────── */
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === currentPage) link.classList.add('active');
  else link.classList.remove('active');
});

/* ─── Search focus ring ────────────────────────────────────── */
const searchInput = document.querySelector('.nav-search input');
if (searchInput) {
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && searchInput.value.trim()) {
      window.location.href = 'marketplace.html?q=' + encodeURIComponent(searchInput.value.trim());
    }
  });
}

/* ─── Smooth product card link ─────────────────────────────── */
document.querySelectorAll('.product-card[data-href]').forEach(card => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => window.location.href = card.dataset.href);
});

/* ─── Fade in keyframe ─────────────────────────────────────── */
const style = document.createElement('style');
style.textContent = `@keyframes fadeOut { to { opacity:0; transform:translateX(20px); } }`;
document.head.appendChild(style);
