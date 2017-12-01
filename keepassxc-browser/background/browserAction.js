const browserAction = {};

const BLINK_TIMEOUT_DEFAULT = 7500;
const BLINK_TIMEOUT_REDIRECT_THRESHOLD_TIME_DEFAULT = -1;
const BLINK_TIMEOUT_REDIRECT_COUNT_DEFAULT = 1;

browserAction.show = function(callback, tab) {
	let data = {};
	if (!page.tabs[tab.id] || page.tabs[tab.id].stack.length == 0) {
		browserAction.showDefault(callback, tab);
		return;
	}
	else {
		data = page.tabs[tab.id].stack[page.tabs[tab.id].stack.length - 1];
	}

	browser.browserAction.setIcon({
		tabId: tab.id,
		path: '/icons/19x19/' + browserAction.generateIconName(data.iconType, data.icon)
	});

	if (data.popup) {
		browser.browserAction.setPopup({
			tabId: tab.id,
			popup: 'popups/' + data.popup
		});
	}
};

browserAction.update = function(interval) {
	if (!page.tabs[page.currentTabId] || page.tabs[page.currentTabId].stack.length === 0) {
		return;
	}

	let data = page.tabs[page.currentTabId].stack[page.tabs[page.currentTabId].stack.length - 1];

    if (typeof data.visibleForMilliSeconds !== 'undefined') {
		if (data.visibleForMilliSeconds <= 0) {
			browserAction.stackPop(page.currentTabId);
			browserAction.show(null, {'id': page.currentTabId});
			page.clearCredentials(page.currentTabId);
            return;
		}
		data.visibleForMilliSeconds -= interval;
	}

	if (data.intervalIcon) {
		data.intervalIcon.counter += 1;
		if (data.intervalIcon.counter < data.intervalIcon.max) {
			return;
		}

		data.intervalIcon.counter = 0;
		data.intervalIcon.index += 1;

		if (data.intervalIcon.index > data.intervalIcon.icons.length - 1) {
			data.intervalIcon.index = 0;
		}

		browser.browserAction.setIcon({
			tabId: page.currentTabId,
			path: '/icons/19x19/' + browserAction.generateIconName(null, data.intervalIcon.icons[data.intervalIcon.index])
		});
	}
};

browserAction.showDefault = function(callback, tab) {
	let stackData = {
		level: 1,
		iconType: 'normal',
		popup: 'popup.html'
	};
	keepass.isConfigured().then((response) => {
		if (!response || keepass.isDatabaseClosed || !keepass.isKeePassXCAvailable || page.tabs[tab.id].errorMessage) {
			stackData.iconType = 'cross';
		}

		if (page.tabs[tab.id].loginList.length > 0) {
	        stackData.iconType = 'questionmark';
	        stackData.popup = 'popup_login.html';
	    }

		browserAction.stackUnshift(stackData, tab.id);
		browserAction.show(null, tab);
	});
};

browserAction.stackAdd = function(callback, tab, icon, popup, level, push, visibleForMilliSeconds, visibleForPageUpdates, redirectOffset,  dontShow) {
	const id = tab.id || page.currentTabId;

	if (!level) {
		level = 1;
	}

	let stackData = {
		level: level,
		icon: icon
	};

	if (popup) {
		stackData.popup = popup;
	}

	if (visibleForMilliSeconds) {
		stackData.visibleForMilliSeconds = visibleForMilliSeconds;
	}

	if (visibleForPageUpdates) {
		stackData.visibleForPageUpdates = visibleForPageUpdates;
	}

	if (redirectOffset) {
		stackData.redirectOffset = redirectOffset;
	}

	if (push) {
		browserAction.stackPush(stackData, id);
	}
	else {
		browserAction.stackUnshift(stackData, id);
	}

	if (!dontShow) {
		browserAction.show(null, {'id': id});
	}
};

browserAction.removeLevelFromStack = function(callback, tab, level, type, dontShow) {
	if (!page.tabs[tab.id]) {
		return;
	}

	if (!type) {
		type = '<=';
	}

	let newStack = [];
	for (const i of page.tabs[tab.id].stack) {
		if (
			(type == '<' && i.level >= level) ||
			(type == '<=' && i.level > level) ||
			(type == '=' && i.level != level) ||
			(type == '==' && i.level != level) ||
			(type == '!=' && i.level == level) ||
			(type == '>' && i.level <= level) ||
			(type == '>=' && i.level < level)
		) {
			newStack.push(i);
		}
	}

	page.tabs[tab.id].stack = newStack;

	if (!dontShow) {
		browserAction.show(callback, tab);
	}
};

browserAction.stackPop = function(tabId) {
	const id = tabId || page.currentTabId;
	page.tabs[id].stack.pop();
};

browserAction.stackPush = function(data, tabId) {
	const id = tabId || page.currentTabId;
	browserAction.removeLevelFromStack(null, {'id': id}, data.level, '<=', true);
	page.tabs[id].stack.push(data);
};

browserAction.stackUnshift = function(data, tabId) {
	const id = tabId || page.currentTabId;
	browserAction.removeLevelFromStack(null, {'id': id}, data.level, '<=', true);
	page.tabs[id].stack.unshift(data);
};


browserAction.removeRememberPopup = function(callback, tab, removeImmediately) {
	if (!page.tabs[tab.id]) {
		return;
	}

	if( page.tabs[tab.id].stack.length == 0) {
        page.clearCredentials(tab.id);
		return;
	}
	const data = page.tabs[tab.id].stack[page.tabs[tab.id].stack.length - 1];

    if (removeImmediately || !isNaN(data.visibleForPageUpdates)) {
		const currentMS = Date.now();
		if (removeImmediately || (data.visibleForPageUpdates <= 0 && data.redirectOffset > 0)) {
			browserAction.stackPop(tab.id);
			browserAction.show(null, {"id": tab.id});
			page.clearCredentials(tab.id);
			return;
		}
		else if (!isNaN(data.visibleForPageUpdates) && data.redirectOffset > 0 && currentMS >= data.redirectOffset) {
			data.visibleForPageUpdates = data.visibleForPageUpdates - 1;
		}
    }
};

browserAction.setRememberPopup = function(tabId, username, password, url, usernameExists, credentialsList) {
	const settings = typeof(localStorage.settings) === 'undefined' ? {} : JSON.parse(localStorage.settings);
	const id = tabId || page.currentTabId;
	let timeoutMinMillis = Number(getValueOrDefault(settings, 'blinkMinTimeout', BLINK_TIMEOUT_REDIRECT_THRESHOLD_TIME_DEFAULT, 0));

	if (timeoutMinMillis > 0) {
		timeoutMinMillis += Date.now();
	}

	const blinkTimeout = getValueOrDefault(settings, 'blinkTimeout', BLINK_TIMEOUT_DEFAULT, 0);
	const pageUpdateAllowance = getValueOrDefault(settings, 'allowedRedirect', BLINK_TIMEOUT_REDIRECT_COUNT_DEFAULT, 0);

	const stackData = {
        visibleForMilliSeconds: blinkTimeout,
		visibleForPageUpdates: pageUpdateAllowance,
		redirectOffset: timeoutMinMillis,
		level: 10,
		intervalIcon: {
			index: 0,
			counter: 0,
			max: 2,
			icons: ['icon_remember_red_background_19x19.png', 'icon_remember_red_lock_19x19.png']
		},
		icon: 'icon_remember_red_background_19x19.png',
		popup: 'popup_remember.html'
	};

	browserAction.stackPush(stackData, id);

	page.tabs[id].credentials = {
		username: username,
		password: password,
		url: url,
		usernameExists: usernameExists,
		list: credentialsList
	};

	browserAction.show(null, {'id': id});
};

function getValueOrDefault(settings, key, defaultVal, min) {
	try {
		let val = settings[key];
		if (isNaN(val) || val < min) {
			val = defaultVal;
		}
		return val;
	} catch(e) {
		return defaultVal;
	}
}

browserAction.generateIconName = function(iconType, icon) {
	if (icon) {
		return icon;
	}

	let name = 'icon_';
	name += (keepass.keePassXCUpdateAvailable()) ? 'new_' : '';
	name += (!iconType || iconType === 'normal') ? 'normal' : iconType;
	name += '_19x19.png';

	return name;
};
