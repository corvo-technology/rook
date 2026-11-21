/** Why a run stopped short, as the ticket comment words it. `text` is already in the person's language. */
export type TicketStopReason = { kind: "cut" } | { kind: "left" } | { kind: "text"; text: string };

type TicketCopy = {
  idle: (minutes: number, step: number, max: number) => string;
  stalled: (max: number) => string;
  continuing: (step: number, max: number, why: string, left: string | undefined) => string;
  capped: (max: number, left: string | undefined, why: string) => string;
  reasonCut: string;
  reasonLeft: string;
  outOfCredits: string;
  storageFull: string;
};

const EN: TicketCopy = {
  idle: (minutes, step, max) =>
    `No activity for ${minutes} minutes. Continuing (follow-up ${step} of ${max}).`,
  stalled: (max) =>
    `Stopped: no progress after ${max} follow-up runs. It needs a decision or new input before it can go on.`,
  continuing: (step, max, why, left) =>
    `Continuing (follow-up ${step} of ${max}). ${why}${left ? ` Left: ${left}` : ""}`,
  capped: (max, left, why) =>
    `Stopped after ${max} follow-up runs without meeting the acceptance criteria. ${left ? `Still left: ${left} ` : ""}Why it stopped: ${why}`,
  reasonCut: "A tool call limit ended the run.",
  reasonLeft: "The run ended with work left.",
  outOfCredits:
    "The model connection is out of credits. Add credits to it, or connect another model, to continue.",
  storageFull:
    "Paused: this agent's computer is full. Free up space on it and this ticket will continue.",
};

/** Server-written ticket comments in each language the app is translated into; English is the source. */
const TICKET_COPY: Record<string, TicketCopy> = {
  "pt-BR": {
    idle: (minutes, step, max) =>
      `Sem atividade há ${minutes} minutos. Continuando (retomada ${step} de ${max}).`,
    stalled: (max) =>
      `Parado: sem progresso após ${max} retomadas. Precisa de uma decisão ou de novas informações para continuar.`,
    continuing: (step, max, why, left) =>
      `Continuando (retomada ${step} de ${max}). ${why}${left ? ` Falta: ${left}` : ""}`,
    capped: (max, left, why) =>
      `Parado após ${max} retomadas sem atender aos critérios de aceite. ${left ? `Ainda falta: ${left} ` : ""}Motivo: ${why}`,
    reasonCut: "O limite de chamadas de ferramentas encerrou a execução.",
    reasonLeft: "A execução terminou com trabalho pendente.",
    outOfCredits:
      "A conexão do modelo está sem créditos. Adicione créditos a ela ou conecte outro modelo para continuar.",
    storageFull:
      "Pausado: o computador deste agente está cheio. Libere espaço nele e este ticket continua.",
  },
  es: {
    idle: (minutes, step, max) =>
      `Sin actividad durante ${minutes} minutos. Continuando (reintento ${step} de ${max}).`,
    stalled: (max) =>
      `Detenido: sin avances tras ${max} reintentos. Necesita una decisión o nueva información para seguir.`,
    continuing: (step, max, why, left) =>
      `Continuando (reintento ${step} de ${max}). ${why}${left ? ` Falta: ${left}` : ""}`,
    capped: (max, left, why) =>
      `Detenido tras ${max} reintentos sin cumplir los criterios de aceptación. ${left ? `Aún falta: ${left} ` : ""}Motivo: ${why}`,
    reasonCut: "Un límite de llamadas a herramientas terminó la ejecución.",
    reasonLeft: "La ejecución terminó con trabajo pendiente.",
    outOfCredits:
      "La conexión del modelo se quedó sin créditos. Añade créditos o conecta otro modelo para continuar.",
    storageFull:
      "En pausa: el equipo de este agente está lleno. Libera espacio en él y este ticket continuará.",
  },
  de: {
    idle: (minutes, step, max) =>
      `Seit ${minutes} Minuten keine Aktivität. Es geht weiter (Folgelauf ${step} von ${max}).`,
    stalled: (max) =>
      `Gestoppt: kein Fortschritt nach ${max} Folgeläufen. Es braucht eine Entscheidung oder neue Angaben, um weiterzumachen.`,
    continuing: (step, max, why, left) =>
      `Es geht weiter (Folgelauf ${step} von ${max}). ${why}${left ? ` Offen: ${left}` : ""}`,
    capped: (max, left, why) =>
      `Gestoppt nach ${max} Folgeläufen ohne Erfüllung der Abnahmekriterien. ${left ? `Noch offen: ${left} ` : ""}Grund: ${why}`,
    reasonCut: "Ein Limit für Werkzeugaufrufe hat den Lauf beendet.",
    reasonLeft: "Der Lauf endete mit offener Arbeit.",
    outOfCredits:
      "Die Modellverbindung hat kein Guthaben mehr. Lade Guthaben auf oder verbinde ein anderes Modell, um fortzufahren.",
    storageFull:
      "Pausiert: Der Computer dieses Agenten ist voll. Gib dort Speicherplatz frei, dann geht dieses Ticket weiter.",
  },
  fr: {
    idle: (minutes, step, max) =>
      `Aucune activité depuis ${minutes} minutes. Reprise (relance ${step} sur ${max}).`,
    stalled: (max) =>
      `Arrêté : aucun progrès après ${max} relances. Il faut une décision ou de nouvelles informations pour continuer.`,
    continuing: (step, max, why, left) =>
      `Reprise (relance ${step} sur ${max}). ${why}${left ? ` Reste : ${left}` : ""}`,
    capped: (max, left, why) =>
      `Arrêté après ${max} relances sans atteindre les critères d'acceptation. ${left ? `Reste : ${left} ` : ""}Raison : ${why}`,
    reasonCut: "Une limite d'appels d'outils a mis fin à l'exécution.",
    reasonLeft: "L'exécution s'est terminée avec du travail restant.",
    outOfCredits:
      "La connexion du modèle n'a plus de crédits. Ajoutez des crédits ou connectez un autre modèle pour continuer.",
    storageFull:
      "En pause : l'ordinateur de cet agent est plein. Libérez de l'espace dessus et ce ticket reprendra.",
  },
  ja: {
    idle: (minutes, step, max) =>
      `${minutes}分間動きがありません。再開します(${max}回中${step}回目)。`,
    stalled: (max) =>
      `停止: ${max}回の再開でも進みませんでした。続けるには判断か新しい情報が必要です。`,
    continuing: (step, max, why, left) =>
      `再開します(${max}回中${step}回目)。${why}${left ? ` 残り: ${left}` : ""}`,
    capped: (max, left, why) =>
      `${max}回の再開でも受け入れ基準を満たせず停止しました。${left ? `残り: ${left} ` : ""}理由: ${why}`,
    reasonCut: "ツール呼び出しの上限で実行が終了しました。",
    reasonLeft: "作業が残ったまま実行が終了しました。",
    outOfCredits:
      "モデル接続のクレジットが残っていません。クレジットを追加するか、別のモデルを接続してください。",
    storageFull:
      "一時停止: このエージェントのコンピューターがいっぱいです。空き容量を確保すると、このチケットは再開します。",
  },
  "zh-CN": {
    idle: (minutes, step, max) =>
      `已 ${minutes} 分钟没有动静。继续处理(第 ${step}/${max} 次跟进)。`,
    stalled: (max) => `已停止:${max} 次跟进后仍无进展。需要决定或新的信息才能继续。`,
    continuing: (step, max, why, left) =>
      `继续处理(第 ${step}/${max} 次跟进)。${why}${left ? ` 剩余:${left}` : ""}`,
    capped: (max, left, why) =>
      `${max} 次跟进后仍未满足验收标准,已停止。${left ? `仍剩余:${left} ` : ""}原因:${why}`,
    reasonCut: "工具调用上限结束了这次运行。",
    reasonLeft: "运行结束时仍有工作未完成。",
    outOfCredits: "模型连接的额度已用完。请充值或连接其他模型后继续。",
    storageFull: "已暂停:此智能体的电脑已满。释放空间后,此工单将继续。",
  },
};

/**
 * The comments the ticket sweep and run endings leave on a ticket, in the person's language, for
 * text that is stored and shown as written. A language without a translation reads in English.
 */
export function ticketCopy(locale: string | undefined) {
  const copy = (locale ? TICKET_COPY[locale] : undefined) ?? EN;
  const why = (reason: TicketStopReason) =>
    reason.kind === "cut" ? copy.reasonCut : reason.kind === "left" ? copy.reasonLeft : reason.text;
  return {
    idle: copy.idle,
    stalled: copy.stalled,
    continuing: (step: number, max: number, reason: TicketStopReason, left?: string) =>
      copy.continuing(step, max, why(reason), left),
    capped: (max: number, reason: TicketStopReason, left?: string) =>
      copy.capped(max, left, why(reason)),
    outOfCredits: copy.outOfCredits,
    storageFull: copy.storageFull,
  };
}
