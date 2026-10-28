import { provide, type InjectionKey } from 'vue'
export type HelpScope = 'training' | 'dataset' | 'network'
export const fieldHelpScope: InjectionKey<HelpScope> = Symbol('field-help-scope')
export function provideFieldHelp(scope: HelpScope) { provide(fieldHelpScope, scope) }
