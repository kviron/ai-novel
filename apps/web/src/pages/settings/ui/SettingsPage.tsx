import { SettingsContent } from './SettingsContent'

export function SettingsPage() {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pb-6 pt-16">
    <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
    <SettingsContent />
  </div>
}
