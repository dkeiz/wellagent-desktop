class CalendarWidget {
    constructor() {
        this.events = [];
        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
        this.flyoutAutoHideMs = 6000;
        this.flyoutHideTimer = null;
        this.isFlyoutOpen = false;
        this.calendarDock = null;
        this.calendarDockDate = null;
        this.calendarFlyout = null;
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
        this.handleWindowBlur = this.handleWindowBlur.bind(this);
        this.renderCalendar();
        this.initializeEvents();
    }

    initializeEvents() {
        this.initializeDock();
        this.updateDockDateLabel();

        // Load initial events
        this.loadEvents();

        // Add event button
        const addEventBtn = document.getElementById('add-event-btn');
        if (addEventBtn) {
            addEventBtn.addEventListener('click', () => {
                this.showAddEventModal();
            });
        }

        // Listen for calendar updates
        if (typeof window.electronAPI?.onCalendarUpdate === 'function') {
            window.electronAPI.onCalendarUpdate(() => {
                this.loadEvents();
            });
        }
    }

    initializeDock() {
        this.calendarDock = document.getElementById('calendar-dock');
        this.calendarDockDate = document.getElementById('calendar-dock-date');
        this.calendarFlyout = document.getElementById('calendar-flyout');
        this.statusbarCalendarDock = document.getElementById('status-bar-calendar');
        this.statusbarCalendarDockDate = document.getElementById('status-bar-date');

        if (!this.calendarFlyout) {
            return;
        }

        if (this.calendarFlyout.parentElement !== document.body) {
            document.body.appendChild(this.calendarFlyout);
        }

        if (this.calendarDock) {
            this.calendarDock.addEventListener('click', () => {
                if (this.isFlyoutOpen && this.activeDock === this.calendarDock) {
                    this.closeFlyout();
                    return;
                }
                this.openFlyout(this.calendarDock, false);
            });

            this.calendarDock.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                if (this.isFlyoutOpen && this.activeDock === this.calendarDock) {
                    this.closeFlyout();
                    return;
                }
                this.openFlyout(this.calendarDock, false);
            });
        }

        if (this.statusbarCalendarDock) {
            this.statusbarCalendarDock.addEventListener('click', () => {
                if (this.isFlyoutOpen && this.activeDock === this.statusbarCalendarDock) {
                    this.closeFlyout();
                    return;
                }
                this.openFlyout(this.statusbarCalendarDock, true);
            });

            this.statusbarCalendarDock.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                if (this.isFlyoutOpen && this.activeDock === this.statusbarCalendarDock) {
                    this.closeFlyout();
                    return;
                }
                this.openFlyout(this.statusbarCalendarDock, true);
            });
        }

        const keepOpen = () => this.bumpFlyoutTimer();
        this.calendarFlyout.addEventListener('mouseenter', keepOpen);
        this.calendarFlyout.addEventListener('pointerdown', keepOpen);
        this.calendarFlyout.addEventListener('pointermove', keepOpen);
        this.calendarFlyout.addEventListener('keydown', keepOpen);

        document.addEventListener('pointerdown', this.handleDocumentPointerDown);
        document.addEventListener('keydown', this.handleDocumentKeyDown);
        window.addEventListener('blur', this.handleWindowBlur);
    }

    openFlyout(dockEl = this.calendarDock, isStatusbar = false) {
        if (!dockEl || !this.calendarFlyout) {
            return;
        }
        this.isFlyoutOpen = true;
        this.activeDock = dockEl;
        this.positionFlyout(dockEl, isStatusbar);
        this.calendarFlyout.classList.add('open');
        this.calendarFlyout.setAttribute('aria-hidden', 'false');
        this.calendarDock?.setAttribute('aria-expanded', 'false');
        this.statusbarCalendarDock?.setAttribute('aria-expanded', 'false');
        dockEl.setAttribute('aria-expanded', 'true');

        if (isStatusbar) {
            this.calendarFlyout.classList.add('from-statusbar');
        } else {
            this.calendarFlyout.classList.remove('from-statusbar');
        }

        this.bumpFlyoutTimer();
    }

    positionFlyout(dockEl, isStatusbar = false) {
        if (!dockEl || !this.calendarFlyout) {
            return;
        }

        const rect = dockEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const flyoutWidth = 280;
        const horizontalMargin = 8;
        const verticalGap = 8;

        this.calendarFlyout.style.position = 'fixed';
        this.calendarFlyout.style.width = `${flyoutWidth}px`;
        this.calendarFlyout.style.left = 'auto';
        this.calendarFlyout.style.right = 'auto';
        this.calendarFlyout.style.top = 'auto';
        this.calendarFlyout.style.bottom = 'auto';

        let left = rect.left;
        if (isStatusbar) {
            left = rect.right - flyoutWidth;
        }
        left = Math.max(horizontalMargin, Math.min(left, viewportWidth - flyoutWidth - horizontalMargin));

        const top = Math.max(horizontalMargin, rect.top - verticalGap);

        this.calendarFlyout.style.left = `${left}px`;
        this.calendarFlyout.style.bottom = `${Math.max(horizontalMargin, window.innerHeight - top)}px`;
    }

    closeFlyout() {
        if (!this.calendarFlyout) {
            return;
        }
        this.isFlyoutOpen = false;
        this.clearFlyoutTimer();
        this.calendarFlyout.classList.remove('open');
        this.calendarFlyout.classList.remove('from-statusbar');
        this.calendarFlyout.setAttribute('aria-hidden', 'true');
        if (this.activeDock) {
            this.activeDock.setAttribute('aria-expanded', 'false');
        } else {
            this.calendarDock?.setAttribute('aria-expanded', 'false');
            this.statusbarCalendarDock?.setAttribute('aria-expanded', 'false');
        }
        this.activeDock = null;
    }

    bumpFlyoutTimer() {
        if (!this.isFlyoutOpen) {
            return;
        }
        this.clearFlyoutTimer();
        this.flyoutHideTimer = setTimeout(() => {
            this.closeFlyout();
        }, this.flyoutAutoHideMs);
    }

    clearFlyoutTimer() {
        if (this.flyoutHideTimer) {
            clearTimeout(this.flyoutHideTimer);
            this.flyoutHideTimer = null;
        }
    }

    handleDocumentPointerDown(event) {
        if (!this.isFlyoutOpen || !this.calendarFlyout) {
            return;
        }
        const target = event.target;
        if (this.calendarFlyout.contains(target) || 
            (this.calendarDock && this.calendarDock.contains(target)) ||
            (this.statusbarCalendarDock && this.statusbarCalendarDock.contains(target))) {
            this.bumpFlyoutTimer();
            return;
        }
        this.closeFlyout();
    }

    handleDocumentKeyDown(event) {
        if (event.key === 'Escape' && this.isFlyoutOpen) {
            this.closeFlyout();
            if (this.activeDock) {
                this.activeDock.focus();
            } else {
                this.calendarDock?.focus();
            }
        }
    }

    handleWindowBlur() {
        if (this.isFlyoutOpen) {
            this.closeFlyout();
        }
    }

    updateDockDateLabel() {
        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        if (this.calendarDockDate) {
            this.calendarDockDate.textContent = dateStr;
        }
        if (this.statusbarCalendarDockDate) {
            this.statusbarCalendarDockDate.textContent = dateStr;
        }
    }

    async loadEvents() {
        try {
            this.events = await window.electronAPI.getCalendarEvents();
            this.renderEvents();
            this.renderCalendar();
        } catch (error) {
            console.error('Error loading calendar events:', error);
        }
    }

    renderEvents() {
        const container = document.getElementById('calendar-events');
        if (!container) return;
        container.replaceChildren();

        if (this.events.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'no-events';
            empty.textContent = 'No upcoming events';
            container.appendChild(empty);
            return;
        }

        // Sort events by start time
        const sortedEvents = [...this.events].sort((a, b) =>
            new Date(a.start_time) - new Date(b.start_time)
        );

        // Show only upcoming events (next 7 days)
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        sortedEvents.forEach(event => {
            const eventDate = new Date(event.start_time);
            if (eventDate >= now && eventDate <= sevenDaysFromNow) {
                const eventElement = this.createEventElement(event);
                container.appendChild(eventElement);
            }
        });

        if (container.children.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'no-events';
            empty.textContent = 'No events in the next 7 days';
            container.appendChild(empty);
        }
    }

    renderCalendar() {
        const now = new Date();
        const year = this.currentYear;
        const month = this.currentMonth;
        const today = (now.getFullYear() === year && now.getMonth() === month) ? now.getDate() : null;
        this.updateDockDateLabel();

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const firstDayOfWeek = firstDayOfMonth.getDay();
        const totalDays = lastDayOfMonth.getDate();

        // Update calendar header with current month/year and navigation buttons
        const calendarHeader = document.getElementById('calendar-header');
        if (calendarHeader) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            calendarHeader.innerHTML = `
                <button class="calendar-nav-btn" id="prev-month" title="Previous Month">◀</button>
                <span>${monthNames[month]} ${year}</span>
                <button class="calendar-nav-btn" id="next-month" title="Next Month">▶</button>
            `;

            // Add event listeners for navigation buttons
            document.getElementById('prev-month').addEventListener('click', () => this.previousMonth());
            document.getElementById('next-month').addEventListener('click', () => this.nextMonth());
        }

        this.renderWeekdays();
        const daysContainer = document.getElementById('calendar-days');
        if (!daysContainer) return;
        daysContainer.innerHTML = '';

        // Add padding for days before the 1st
        for (let i = 0; i < firstDayOfWeek; i++) {
            const paddingDay = document.createElement('div');
            paddingDay.className = 'calendar-day empty';
            daysContainer.appendChild(paddingDay);
        }

        // Add days of the month
        for (let day = 1; day <= totalDays; day++) {
            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            if (today && day === today) {
                dayElement.classList.add('today');
            }
            dayElement.textContent = day;

            dayElement.addEventListener('click', (event) => {
                const selected = document.querySelector('.calendar-day.selected');
                if (selected) {
                    selected.classList.remove('selected');
                }
                event.currentTarget.classList.add('selected');

                // Filter chats by this day
                const clickedDate = new Date(year, month, day).toISOString().split('T')[0];
                if (window.sidebar) {
                    window.sidebar.loadChatSessions(clickedDate);
                }
            });

            daysContainer.appendChild(dayElement);
        }
    }

    renderWeekdays() {
        const weekdaysContainer = document.getElementById('calendar-weekdays');
        if (!weekdaysContainer) return;
        weekdaysContainer.innerHTML = '';
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekdays.forEach(day => {
            const weekdayElement = document.createElement('div');
            weekdayElement.className = 'calendar-weekday';
            weekdayElement.textContent = day;
            weekdaysContainer.appendChild(weekdayElement);
        });
    }

    createEventElement(event) {
        const element = document.createElement('div');
        element.className = 'calendar-event';

        const startTime = new Date(event.start_time);
        const endTime = new Date(startTime.getTime() + event.duration_minutes * 60000);

        const title = document.createElement('h4');
        title.textContent = event.title;
        element.appendChild(title);

        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = [
            startTime.toLocaleDateString(),
            '•',
            `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        ].join(' ');
        element.appendChild(time);

        if (event.description) {
            const description = document.createElement('div');
            description.className = 'description';
            description.textContent = event.description;
            element.appendChild(description);
        }

        const actions = document.createElement('div');
        actions.className = 'event-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-event';
        deleteBtn.dataset.id = String(event.id);
        deleteBtn.textContent = '🗑️';
        actions.appendChild(deleteBtn);
        element.appendChild(actions);

        // Add delete event listener
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteEvent(event.id);
        });

        return element;
    }

    showAddEventModal() {
        // Simple modal for adding events
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Add Calendar Event</h3>
                <form id="add-event-form">
                    <label>
                        Title:
                        <input type="text" name="title" required>
                    </label>
                    <label>
                        Start Time:
                        <input type="datetime-local" name="start_time" required>
                    </label>
                    <label>
                        Duration (minutes):
                        <input type="number" name="duration_minutes" value="60" min="1">
                    </label>
                    <label>
                        Description:
                        <textarea name="description" rows="3"></textarea>
                    </label>
                    <div class="modal-actions">
                        <button type="button" class="secondary-btn cancel-btn">Cancel</button>
                        <button type="submit" class="primary-btn">Add Event</button>
                    </div>
                </form>
            </div>
        `;

        // Add modal styles
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;

        modal.querySelector('.modal-content').style.cssText = `
            background: white;
            padding: 2rem;
            border-radius: var(--border-radius);
            width: 400px;
            max-width: 90%;
        `;

        // Set default start time to current time rounded to next 15 minutes
        const now = new Date();
        const minutes = Math.ceil(now.getMinutes() / 15) * 15;
        now.setMinutes(minutes);
        now.setSeconds(0);
        now.setMilliseconds(0);

        const startTimeInput = modal.querySelector('input[name="start_time"]');
        startTimeInput.value = now.toISOString().slice(0, 16);

        // Form submission
        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const eventData = {
                title: formData.get('title'),
                start_time: formData.get('start_time'),
                duration_minutes: parseInt(formData.get('duration_minutes')),
                description: formData.get('description')
            };

            try {
                await window.electronAPI.addCalendarEvent(eventData);
                modal.remove();
            } catch (error) {
                console.error('Error adding event:', error);
                alert('Error adding event: ' + error.message);
            }
        });

        // Cancel button
        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        document.body.appendChild(modal);
    }

    async deleteEvent(eventId) {
        if (confirm('Are you sure you want to delete this event?')) {
            try {
                await window.electronAPI.deleteCalendarEvent(eventId);
            } catch (error) {
                console.error('Error deleting event:', error);
                alert('Error deleting event: ' + error.message);
            }
        }
    }

    previousMonth() {
        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.renderCalendar();
    }

    nextMonth() {
        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.renderCalendar();
    }
}

// Initialize calendar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.calendarWidget = new CalendarWidget();
});
