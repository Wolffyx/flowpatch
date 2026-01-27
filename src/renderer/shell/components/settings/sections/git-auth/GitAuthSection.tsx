import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Link, Shield, Wrench } from 'lucide-react'
import type { GitAuthMode, GitAuthState } from '@shared/types'
import { Button } from '../../../../../src/components/ui/button'
import { Badge } from '../../../../../src/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../../src/components/ui/select'
import { Switch } from '../../../../../src/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../src/components/ui/card'
import { useSettingsContext } from '../../hooks/useSettingsContext'
import { cn } from '../../../../../src/lib/utils'

type Mode = GitAuthMode

interface AuthState extends GitAuthState {
  loading?: boolean
}

const MODE_OPTIONS: { id: Mode; label: string; desc: string }[] = [
  { id: 'auto', label: 'Auto', desc: 'Prefer SSH; fall back to HTTPS/CLI when available.' },
  { id: 'ssh', label: 'SSH', desc: 'Force SSH remote and key-based auth.' },
  { id: 'https', label: 'HTTPS', desc: 'Use HTTPS with credential helper or CLI tokens.' },
  { id: 'gh_cli', label: 'GitHub CLI', desc: 'Use gh auth for HTTPS tokens.' },
  { id: 'glab_cli', label: 'GitLab CLI', desc: 'Use glab auth for HTTPS tokens.' }
]

export function GitAuthSection(): React.JSX.Element {
  const { project } = useSettingsContext()
  const [mode, setMode] = useState<Mode>('auto')
  const [forceSsh, setForceSsh] = useState(false)
  const [state, setState] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!project) return
    setLoading(true)
    const result = await window.shellAPI.getGitAuthState(project.id)
    setState(result.state)
    setMode(result.mode)
    setForceSsh(result.forceSshRewrite)
    setLoading(false)
  }, [project])

  const save = useCallback(
    async (nextMode: Mode, nextForce: boolean) => {
      if (!project) return
      setLoading(true)
      await window.shellAPI.setGitAuthMode(project.id, { mode: nextMode, forceSshRewrite: nextForce })
      await load()
    },
    [project, load]
  )

  useEffect(() => {
    load()
  }, [load])

  const warning = state?.warnings?.[0]
  const ok = state && !state.warnings?.length

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Git Authentication</h3>
        <p className="text-xs text-muted-foreground">
          Choose how FlowPatch authenticates git pushes. Worktrees use the same remote as the main repo.
        </p>
      </div>

      <Card className="border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" /> Mode
          </CardTitle>
          {loading ? (
            <Badge variant="outline">Checking…</Badge>
          ) : ok ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">OK</Badge>
          ) : warning ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Warning
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium">Preferred mode</label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  const next = v as Mode
                  setMode(next)
                  void save(next, forceSsh)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-[11px] text-muted-foreground">{opt.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">Rewrite remotes to SSH</div>
                  <div className="text-[11px] text-muted-foreground">
                    If remote is HTTPS, set it to git@host:org/repo automatically.
                  </div>
                </div>
                <Switch
                  checked={forceSsh}
                  onCheckedChange={(v) => {
                    setForceSsh(v)
                    void save(mode, v)
                  }}
                />
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/40">
            <div className="font-medium text-foreground flex items-center gap-2 mb-1">
              <Link className="h-3.5 w-3.5" />
              Current remote
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-foreground break-all">{state?.remoteUrl ?? 'No origin set'}</span>
              <span>
                Protocol: <code className="text-[11px]">{state?.protocol ?? 'unknown'}</code> · Host:{' '}
                <code className="text-[11px]">{state?.host ?? 'unknown'}</code>
              </span>
            </div>
          </div>

          {warning ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 mt-[2px]" />
              <div>
                <div className="font-medium">Action needed</div>
                <div>{warning}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="xs" variant="destructive" onClick={() => window.shellAPI.fixRemoteToSsh(project!.id)}>
                    Rewrite to SSH
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => window.shellAPI.testGitAuth(project!.id)}>
                    Test connection
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-foreground/80">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Ready to push with current auth.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <StatusTile
              icon={<KeyRound className="h-4 w-4" />}
              label="Credential helper"
              ok={!!state?.hasCredentialHelper}
            />
            <StatusTile icon={<Wrench className="h-4 w-4" />} label="SSH reachable" ok={!!state?.sshOk} />
            <StatusTile icon={<Shield className="h-4 w-4" />} label="GitHub CLI" ok={!!state?.hasGhAuth} />
            <StatusTile icon={<Shield className="h-4 w-4" />} label="GitLab CLI" ok={!!state?.hasGlabAuth} />
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <a
              className="inline-flex items-center gap-1 hover:underline"
              href="https://docs.github.com/en/authentication/connecting-to-github-with-ssh"
              target="_blank"
              rel="noreferrer"
            >
              SSH setup guide <ExternalLink className="h-3 w-3" />
            </a>
            <a
              className="inline-flex items-center gap-1 hover:underline"
              href="https://cli.github.com/manual/gh_auth_login"
              target="_blank"
              rel="noreferrer"
            >
              gh auth login <ExternalLink className="h-3 w-3" />
            </a>
            <a
              className="inline-flex items-center gap-1 hover:underline"
              href="https://docs.gitlab.com/ee/user/project/repository/ssh/"
              target="_blank"
              rel="noreferrer"
            >
              GitLab SSH <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatusTile({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2',
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-muted bg-muted/40 text-muted-foreground'
      )}
    >
      {icon}
      <div className="flex-1">{label}</div>
      <div className="text-[11px] font-medium">{ok ? 'OK' : 'Not set'}</div>
    </div>
  )
}
