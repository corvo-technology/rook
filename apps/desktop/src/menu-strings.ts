import type { SetupLocale } from "./setup-locale.js";

/** The labels the native menu and the first-run failure message draw themselves, per language. */
export interface MenuStrings {
  about: string;
  checkForUpdates: string;
  settings: string;
  computerAccess: string;
  revokeComputerAccess: string;
  changeServer: string;
  stopLocalServer: string;
  hide: string;
  quit: string;
  view: string;
  window: string;
  file: string;
  cloudUnreachable: string;
}

const en: MenuStrings = {
  about: "About {name}",
  checkForUpdates: "Check for Updates…",
  settings: "Settings…",
  computerAccess: "Computer Access…",
  revokeComputerAccess: "Revoke Local Computer Access",
  changeServer: "Change Rook Server…",
  stopLocalServer: "Stop Local Server",
  hide: "Hide {name}",
  quit: "Quit {name}",
  view: "View",
  window: "Window",
  file: "File",
  cloudUnreachable: "Could not reach Rook Cloud. Check your connection.",
};

const MENU_STRINGS: Record<SetupLocale, MenuStrings> = {
  en,
  "pt-BR": {
    about: "Sobre o {name}",
    checkForUpdates: "Buscar atualizações…",
    settings: "Configurações…",
    computerAccess: "Acesso ao computador…",
    revokeComputerAccess: "Revogar acesso ao computador local",
    changeServer: "Trocar servidor do Rook…",
    stopLocalServer: "Parar servidor local",
    hide: "Ocultar {name}",
    quit: "Sair do {name}",
    view: "Visualizar",
    window: "Janela",
    file: "Arquivo",
    cloudUnreachable: "Não foi possível acessar o Rook Nuvem. Verifique sua conexão.",
  },
  de: {
    about: "Über {name}",
    checkForUpdates: "Nach Updates suchen …",
    settings: "Einstellungen …",
    computerAccess: "Computerzugriff …",
    revokeComputerAccess: "Lokalen Computerzugriff widerrufen",
    changeServer: "Rook-Server wechseln …",
    stopLocalServer: "Lokalen Server stoppen",
    hide: "{name} ausblenden",
    quit: "{name} beenden",
    view: "Ansicht",
    window: "Fenster",
    file: "Datei",
    cloudUnreachable: "Rook Cloud ist nicht erreichbar. Prüfe deine Verbindung.",
  },
  "zh-CN": {
    about: "关于 {name}",
    checkForUpdates: "检查更新…",
    settings: "设置…",
    computerAccess: "电脑访问…",
    revokeComputerAccess: "撤销本机电脑访问",
    changeServer: "更换 Rook 服务器…",
    stopLocalServer: "停止本地服务器",
    hide: "隐藏 {name}",
    quit: "退出 {name}",
    view: "视图",
    window: "窗口",
    file: "文件",
    cloudUnreachable: "无法连接 Rook 云。请检查网络。",
  },
  es: {
    about: "Acerca de {name}",
    checkForUpdates: "Buscar actualizaciones…",
    settings: "Ajustes…",
    computerAccess: "Acceso al ordenador…",
    revokeComputerAccess: "Revocar el acceso al ordenador local",
    changeServer: "Cambiar el servidor de Rook…",
    stopLocalServer: "Detener el servidor local",
    hide: "Ocultar {name}",
    quit: "Salir de {name}",
    view: "Visualización",
    window: "Ventana",
    file: "Archivo",
    cloudUnreachable: "No se pudo acceder a Rook Nube. Revisa tu conexión.",
  },
  fr: {
    about: "À propos de {name}",
    checkForUpdates: "Rechercher les mises à jour…",
    settings: "Réglages…",
    computerAccess: "Accès à l’ordinateur…",
    revokeComputerAccess: "Révoquer l’accès à l’ordinateur local",
    changeServer: "Changer de serveur Rook…",
    stopLocalServer: "Arrêter le serveur local",
    hide: "Masquer {name}",
    quit: "Quitter {name}",
    view: "Présentation",
    window: "Fenêtre",
    file: "Fichier",
    cloudUnreachable: "Impossible de joindre Rook Nuage. Vérifiez votre connexion.",
  },
  ja: {
    about: "{name}について",
    checkForUpdates: "アップデートを確認…",
    settings: "設定…",
    computerAccess: "コンピュータへのアクセス…",
    revokeComputerAccess: "ローカルコンピュータへのアクセスを取り消す",
    changeServer: "Rook サーバーを変更…",
    stopLocalServer: "ローカルサーバーを停止",
    hide: "{name}を隠す",
    quit: "{name}を終了",
    view: "表示",
    window: "ウインドウ",
    file: "ファイル",
    cloudUnreachable: "Rook クラウドに接続できません。接続を確認してください。",
  },
};

export function menuStrings(locale: SetupLocale): MenuStrings {
  return MENU_STRINGS[locale];
}

/** Fills `{name}` in a label. */
export function withName(text: string, name: string): string {
  return text.replace("{name}", name);
}
