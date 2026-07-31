// Vercel Web Analytics initialization
// This uses the inject method for vanilla JavaScript
(function() {
  // Import from CDN for simplicity with vanilla HTML
  const script = document.createElement('script');
  script.type = 'module';
  script.innerHTML = `
    import { inject } from 'https://cdn.jsdelivr.net/npm/@vercel/analytics@1/+esm';
    inject();
  `;
  document.head.appendChild(script);
})();
