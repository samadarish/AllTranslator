import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    minimum_chrome_version: '109',
    permissions: ['activeTab', 'alarms', 'storage'],
    host_permissions: ['<all_urls>'],
    incognito: 'not_allowed',
    action: {
      default_title: '__MSG_extensionName__',
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Alt+Shift+T',
        },
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
