(() => {
  class WorkflowWidget {
    constructor() {
      this.header = document.getElementById('toggle-workflows-widget');
      this.widget = this.header?.closest('.workflows-widget') || null;
      if (!this.header || !this.widget) return;
      this.bindEvents();
    }

    bindEvents() {
      this.header.addEventListener('click', (event) => {
        const clickedCollapseArrow = Boolean(event.target.closest('.collapse-arrow'));
        if (clickedCollapseArrow) {
          const collapsed = this.widget.classList.toggle('collapsed');
          window.LocalAgentLayoutMode?.setSidebarSectionCollapsed?.('workflows', collapsed);
          return;
        }
        const workflowsNavButton = document.querySelector('.nav-btn[data-tab="workflows"]');
        if (workflowsNavButton) {
          workflowsNavButton.click();
        } else if (window.sidebar?.switchTab) {
          window.sidebar.switchTab('workflows');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new WorkflowWidget());
  } else {
    new WorkflowWidget();
  }
})();
