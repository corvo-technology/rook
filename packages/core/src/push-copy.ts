import type { RunErrorCode } from "@corvo/contracts";
import { reviewBeforeSummary } from "./activity-label.js";

const NEEDS_APPROVAL_SUFFIX = " needs approval";

/** The approval push in each language the app is translated into; English is the source text. */
const APPROVAL_PUSH: Record<
  string,
  { title: (name: string) => string; body: (what: string) => string }
> = {
  "pt-BR": {
    title: (name) => `${name} precisa de aprovação`,
    body: (what) => `Confirme antes: ${what}`,
  },
  es: {
    title: (name) => `${name} necesita aprobación`,
    body: (what) => `Revisa antes: ${what}`,
  },
  de: {
    title: (name) => `${name} braucht eine Freigabe`,
    body: (what) => `Vor dem Ausführen prüfen: ${what}`,
  },
  ja: {
    title: (name) => `${name}の承認が必要です`,
    body: (what) => `実行前に確認: ${what}`,
  },
  "zh-CN": {
    title: (name) => `${name}需要审批`,
    body: (what) => `执行前请确认：${what}`,
  },
};

/**
 * An approval push in the person's language, built from the same "Review before …" title the
 * in-app card translates. Any other push, and any language without a translation, is unchanged.
 */
export function localizedApprovalPush<T extends { title: string; body: string }>(
  message: T,
  locale: string | undefined,
): T {
  const copy = locale ? APPROVAL_PUSH[locale] : undefined;
  const what = reviewBeforeSummary(message.body);
  if (!copy || what === undefined || !message.title.endsWith(NEEDS_APPROVAL_SUFFIX)) return message;
  const name = message.title.slice(0, -NEEDS_APPROVAL_SUFFIX.length);
  return { ...message, title: copy.title(name), body: copy.body(what) };
}

type FailureCopy = { title: (name: string) => string; lines: Record<RunErrorCode, string> };

/** A failed run's push in each language the app is translated into; English stays the message's own text. */
const FAILURE_PUSH: Record<string, FailureCopy> = {
  "pt-BR": {
    title: (name) => `${name} falhou`,
    lines: {
      computer_storage_full: "O computador está sem espaço.",
      computer_start_failed: "Não foi possível iniciar o computador.",
      computer_home_lost: "Os arquivos salvos do computador não foram encontrados.",
      model_provider_error: "O modelo retornou um erro.",
      model_rate_limited: "O modelo está limitando as requisições. Tente de novo em instantes.",
      monthly_limit: "O limite mensal foi atingido.",
      daily_credit_limit: "O limite diário foi atingido.",
      paused: "Os agentes estão pausados.",
      reply_cap: "A resposta atingiu o limite de tokens.",
      plan_storage_full: "O armazenamento do plano está cheio.",
      plan_computer_limit: "O plano atingiu o limite de computadores.",
      no_model_access: "Conecte um modelo para continuar.",
      model_not_allowed: "Este modelo não está disponível. Escolha outro.",
      timeout: "O modelo demorou demais para responder.",
      turn_stopped: "A execução foi interrompida porque não estava avançando.",
      unknown: "Algo deu errado.",
    },
  },
  es: {
    title: (name) => `${name} falló`,
    lines: {
      computer_storage_full: "El equipo se quedó sin espacio.",
      computer_start_failed: "No se pudo iniciar el equipo.",
      computer_home_lost: "No se encontraron los archivos guardados del equipo.",
      model_provider_error: "El modelo devolvió un error.",
      model_rate_limited: "El modelo limita las solicitudes. Inténtalo de nuevo en un momento.",
      monthly_limit: "Se alcanzó el límite mensual.",
      daily_credit_limit: "Se alcanzó el límite diario.",
      paused: "Los agentes están en pausa.",
      reply_cap: "La respuesta alcanzó el límite de tokens.",
      plan_storage_full: "El almacenamiento del plan está lleno.",
      plan_computer_limit: "El plan alcanzó el límite de equipos.",
      no_model_access: "Conecta un modelo para continuar.",
      model_not_allowed: "Este modelo no está disponible. Elige otro.",
      timeout: "El modelo tardó demasiado en responder.",
      turn_stopped: "La ejecución se detuvo porque no avanzaba.",
      unknown: "Algo salió mal.",
    },
  },
  de: {
    title: (name) => `${name} ist fehlgeschlagen`,
    lines: {
      computer_storage_full: "Der Computer hat keinen Speicherplatz mehr.",
      computer_start_failed: "Der Computer konnte nicht gestartet werden.",
      computer_home_lost: "Die gespeicherten Dateien des Computers wurden nicht gefunden.",
      model_provider_error: "Das Modell hat einen Fehler gemeldet.",
      model_rate_limited: "Das Modell drosselt Anfragen. Versuche es gleich noch einmal.",
      monthly_limit: "Das Monatslimit ist erreicht.",
      daily_credit_limit: "Das Tageslimit ist erreicht.",
      paused: "Die Agenten sind pausiert.",
      reply_cap: "Die Antwort hat das Token-Limit erreicht.",
      plan_storage_full: "Der Speicher des Tarifs ist voll.",
      plan_computer_limit: "Der Tarif hat sein Computer-Limit erreicht.",
      no_model_access: "Verbinde ein Modell, um fortzufahren.",
      model_not_allowed: "Dieses Modell ist nicht verfügbar. Wähle ein anderes.",
      timeout: "Das Modell hat zu lange gebraucht.",
      turn_stopped: "Der Lauf wurde gestoppt, weil er nicht vorankam.",
      unknown: "Etwas ist schiefgelaufen.",
    },
  },
  fr: {
    title: (name) => `${name} a échoué`,
    lines: {
      computer_storage_full: "L'ordinateur n'a plus d'espace.",
      computer_start_failed: "L'ordinateur n'a pas pu démarrer.",
      computer_home_lost: "Les fichiers enregistrés de l'ordinateur sont introuvables.",
      model_provider_error: "Le modèle a renvoyé une erreur.",
      model_rate_limited: "Le modèle limite les requêtes. Réessayez dans un instant.",
      monthly_limit: "La limite mensuelle est atteinte.",
      daily_credit_limit: "La limite quotidienne est atteinte.",
      paused: "Les agents sont en pause.",
      reply_cap: "La réponse a atteint la limite de jetons.",
      plan_storage_full: "Le stockage du forfait est plein.",
      plan_computer_limit: "Le forfait a atteint sa limite d'ordinateurs.",
      no_model_access: "Connectez un modèle pour continuer.",
      model_not_allowed: "Ce modèle n’est pas disponible. Choisissez-en un autre.",
      timeout: "Le modèle a mis trop de temps à répondre.",
      turn_stopped: "L'exécution a été arrêtée car elle n'avançait plus.",
      unknown: "Une erreur s'est produite.",
    },
  },
  ja: {
    title: (name) => `${name}が失敗しました`,
    lines: {
      computer_storage_full: "コンピューターの空き容量がありません。",
      computer_start_failed: "コンピューターを起動できませんでした。",
      computer_home_lost: "コンピューターの保存済みファイルが見つかりませんでした。",
      model_provider_error: "モデルがエラーを返しました。",
      model_rate_limited:
        "モデルがリクエストを制限しています。しばらくしてからもう一度お試しください。",
      monthly_limit: "月間の上限に達しました。",
      daily_credit_limit: "1日の上限に達しました。",
      paused: "エージェントは一時停止中です。",
      reply_cap: "返信がトークン上限に達しました。",
      plan_storage_full: "プランのストレージがいっぱいです。",
      plan_computer_limit: "プランのコンピューター数の上限に達しました。",
      no_model_access: "続けるにはモデルを接続してください。",
      model_not_allowed: "このモデルは利用できません。別のモデルを選んでください。",
      timeout: "モデルの応答に時間がかかりすぎました。",
      turn_stopped: "進まなくなったため実行を停止しました。",
      unknown: "問題が発生しました。",
    },
  },
  "zh-CN": {
    title: (name) => `${name}失败了`,
    lines: {
      computer_storage_full: "电脑已没有可用空间。",
      computer_start_failed: "无法启动电脑。",
      computer_home_lost: "找不到电脑已保存的文件。",
      model_provider_error: "模型返回了错误。",
      model_rate_limited: "模型正在限制请求，请稍后再试。",
      monthly_limit: "已达到每月上限。",
      daily_credit_limit: "已达到每日上限。",
      paused: "智能体已暂停。",
      reply_cap: "回复已达到令牌上限。",
      plan_storage_full: "套餐存储空间已满。",
      plan_computer_limit: "套餐已达到电脑数量上限。",
      no_model_access: "请连接模型后继续。",
      model_not_allowed: "此模型不可用。请选择其他模型。",
      timeout: "模型响应时间过长。",
      turn_stopped: "运行因没有进展而停止。",
      unknown: "出了点问题。",
    },
  },
};

/**
 * A failed run's push in the person's language, from the code the run saved. A push without a
 * code, and a language without a translation, is unchanged.
 */
export function localizedFailurePush<
  T extends { title: string; body: string; errorInfo?: { code: RunErrorCode } },
>(message: T, locale: string | undefined): T {
  const copy = locale ? FAILURE_PUSH[locale] : undefined;
  const suffix = " failed";
  if (!copy || !message.errorInfo || !message.title.endsWith(suffix)) return message;
  return {
    ...message,
    title: copy.title(message.title.slice(0, -suffix.length)),
    body: copy.lines[message.errorInfo.code],
  };
}

const DIGEST_TITLE: Record<string, (count: number) => string> = {
  "pt-BR": (count) => `${count} novidades`,
  es: (count) => `${count} novedades`,
  de: (count) => `${count} Neuigkeiten`,
  fr: (count) => `${count} nouveautés`,
  ja: (count) => `${count}件の更新`,
  "zh-CN": (count) => `${count}条更新`,
};

const DIGEST_NAMES_SHOWN = 3;

/**
 * The one push that carries what waited for the morning: a count and who it came from, in the
 * person's language. English is the source text.
 */
export function digestPush(
  count: number,
  agentNames: string[],
  locale: string | undefined,
): { title: string; body: string } {
  const names = [...new Set(agentNames)];
  const shown = names.slice(0, DIGEST_NAMES_SHOWN);
  const more = names.length - shown.length;
  let list = shown.join(", ");
  try {
    list = new Intl.ListFormat(locale ?? "en", {
      style: "long",
      type: more > 0 ? "unit" : "conjunction",
    }).format(shown);
  } catch {
    // An unknown locale keeps the plain comma list.
  }
  return {
    title: (locale ? DIGEST_TITLE[locale] : undefined)?.(count) ?? `${count} updates`,
    body: more > 0 ? `${list} +${more}` : list,
  };
}
