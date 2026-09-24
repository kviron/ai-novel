import { useEffect, useState } from 'react'

import { api, type ProviderStatus } from '@/shared/api'
import { useSidebarPreference } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'

export function SettingsContent() {
  const { showIconsWhenCollapsed, setShowIconsWhenCollapsed } = useSidebarPreference()
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void api.providers(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setProviders(value); setError(false) }
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [attempt])

  function retry() { setLoading(true); setError(false); setAttempt((value) => value + 1) }

  return <div className="flex flex-col gap-4">
    <Card>
      <CardHeader><CardTitle>Интерфейс</CardTitle><CardDescription>Настройки этого браузера</CardDescription></CardHeader>
      <CardContent><FieldGroup><Field orientation="horizontal">
        <FieldLabel htmlFor="sidebar-icons">Показывать иконки при сворачивании</FieldLabel>
        <Switch id="sidebar-icons" checked={showIconsWhenCollapsed} onCheckedChange={setShowIconsWhenCollapsed} />
      </Field></FieldGroup></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Локальная модель</CardTitle><CardDescription>Текущее состояние провайдера — только просмотр</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading && <p role="status">Проверяем провайдера…</p>}
        {error && <Alert variant="destructive"><AlertDescription>Не удалось проверить провайдера. <Button size="sm" variant="outline" onClick={retry}>Повторить</Button></AlertDescription></Alert>}
        {!loading && !error && providers.length === 0 && <p className="text-muted-foreground">Провайдеры не настроены.</p>}
        {!loading && !error && providers.map((provider) => <div key={provider.provider_id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2"><strong>{provider.provider_id}</strong><Badge variant={provider.available ? 'secondary' : 'destructive'}>{provider.available ? 'Доступно' : 'Недоступно'}</Badge></div>
          {provider.detail !== (provider.available ? 'Доступно' : 'Недоступно') && <p className="text-muted-foreground">{provider.detail}</p>}
          {provider.models.map((model) => <p key={model}>{model}</p>)}
        </div>)}
      </CardContent>
    </Card>
  </div>
}
