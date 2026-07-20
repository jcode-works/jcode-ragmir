const FAQ_ITEM_KEYS = [
  ["faq_what_question", "faq_what_answer"],
  ["faq_private_question", "faq_private_answer"],
  ["faq_agents_question", "faq_agents_answer"],
  ["faq_portable_question", "faq_portable_answer"],
  ["faq_team_question", "faq_team_answer"],
  ["faq_offline_question", "faq_offline_answer"],
  ["faq_observability_question", "faq_observability_answer"],
  ["faq_compare_question", "faq_compare_answer"],
  ["faq_role_question", "faq_role_answer"],
  ["faq_formats_question", "faq_formats_answer"],
  ["faq_server_question", "faq_server_answer"],
] as const

export interface FaqItem {
  question: string
  answer: string
}

export function getFaqItems(translations: Record<string, string>): FaqItem[] {
  return FAQ_ITEM_KEYS.map(([questionKey, answerKey]) => ({
    question: translations[questionKey] ?? questionKey,
    answer: translations[answerKey] ?? answerKey,
  }))
}
