// source/js/toc.js
(function() {
  // 滚动时高亮当前阅读位置的目录项
  function initTocHighlight() {
    const tocLinks = document.querySelectorAll('.toc-link');
    if (!tocLinks.length) return;

    const sections = [];
    tocLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const id = href.substring(1);
        const element = document.getElementById(id);
        if (element) {
          sections.push({
            id: id,
            link: link,
            top: element.offsetTop - 100 // 偏移量
          });
        }
      }
    });

    function setActive() {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      let current = null;

      for (let i = sections.length - 1; i >= 0; i--) {
        if (scrollTop >= sections[i].top) {
          current = sections[i];
          break;
        }
      }

      tocLinks.forEach(link => link.classList.remove('active'));
      if (current) {
        current.link.classList.add('active');
      }
    }

    window.addEventListener('scroll', setActive);
    setActive();
  }

  // 平滑滚动
  function initSmoothScroll() {
    document.querySelectorAll('.toc-link[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href === '#') return;
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
          // 可选：更新 URL hash
          history.pushState(null, null, href);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTocHighlight();
      initSmoothScroll();
    });
  } else {
    initTocHighlight();
    initSmoothScroll();
  }
})();