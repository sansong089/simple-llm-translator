import { MENU_IDS } from "../shared/constants";

export function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.translatePage,
      title: "翻译当前页面",
      contexts: ["page", "frame", "selection"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.translateSelection,
      title: "翻译选中文本",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.stopPageTranslation,
      title: "停止翻译当前页面",
      contexts: ["page", "frame", "selection"]
    });
  });
}
