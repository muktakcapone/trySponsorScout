"use client";
import { useState } from 'react';
import { UserRound, ShieldCheck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
export type Account = { id: string; username: string; email: string; name: string; profile: Record<string,string>; decisions: Record<string,'saved'|'skipped'|'applied'> };
export async function accountRequest(action: string, data: unknown = {}) {
  const response = await fetch(`/api/account/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' });
  const result = await response.json() as { account?: Account; recoveryCode?: string; username?: string; error?: string }; if (!response.ok) throw new Error(result.error || 'Please try again.'); return result;
}
export function AccountPanel({ account, onAccount, ready }: {account: Account|null; onAccount: (account: Account|null)=>void; ready: boolean}) {
  const [open,setOpen]=useState(false); const [mode,setMode]=useState('login');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');
  const [recoveryCode,setRecoveryCode]=useState(''); const [saved,setSaved]=useState(false);
  function switchMode(next:string) { setMode(next);setError('');setMessage(''); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);setError('');setMessage('');
    const values=Object.fromEntries(new FormData(event.currentTarget));
    if ((mode==='register'||mode==='reset') && values.password!==values.confirm) {setError('Passwords do not match.');setBusy(false);return;}
    try {
      const result=await accountRequest(mode,values);
      if(result.account) onAccount(result.account);
      if(result.recoveryCode) {setRecoveryCode(result.recoveryCode);setSaved(false);if(mode==='reset') onAccount(null);}
      else if(mode==='username') setMessage(`Your username is ${result.username}. You can now sign in.`);
      else setOpen(false);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function logout() {setBusy(true);setError('');try {await accountRequest('logout');onAccount(null);setOpen(false);switchMode('login');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const label=mode==='register'?'Create your account':mode==='username'?'Forgot username':mode==='reset'?'Reset your password':'Welcome back';
  return <>
    <Button disabled={!ready} variant="outline" onClick={()=>{setOpen(true);setError('');}} className="border-cyan-300/30 text-cyan-100"><UserRound className="size-4"/>{!ready?'Loading account…':account?`@${account.username}`:'Sign in / Create account'}</Button>
    <Sheet open={open} onOpenChange={value=>{if(!busy && (!recoveryCode||saved))setOpen(value);}}>
      <SheetContent className="w-full overflow-y-auto border-white/10 bg-[#091525] p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-7"><div className="mb-3 grid size-12 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><ShieldCheck/></div><SheetTitle className="text-2xl text-white">{recoveryCode?'Save your recovery code':account?'Your account':label}</SheetTitle><SheetDescription className="leading-6 text-slate-400">{recoveryCode?'Keep this code somewhere private, such as a password manager. It is shown only now.':account?'Your search profile and saved roles travel with you across devices.':'A personal space for your next career move.'}</SheetDescription></SheetHeader>
        {recoveryCode ? <div className="mt-6 space-y-5"><p className="text-sm leading-6 text-slate-300">Use your account email and this code if you forget your username or password. Password resets replace the code and sign out all sessions. We do not send recovery emails.</p><label className="block text-sm text-cyan-100">Private recovery code<textarea aria-label="Private recovery code" readOnly value={recoveryCode} className="mt-2 min-h-28 w-full break-all rounded-xl border border-cyan-300/30 bg-slate-950 p-4 font-mono text-sm" onFocus={e=>e.target.select()}/></label><label className="flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I have saved this code in a safe place.</label><Button disabled={!saved} onClick={()=>{setRecoveryCode('');setOpen(false);switchMode('login');}} className="w-full">{account?'Continue to my profile':'Continue to sign in'}</Button></div>
        : account ? <div className="mt-6 space-y-5"><dl className="space-y-4 rounded-xl border border-white/10 p-4 text-sm"><div><dt className="text-slate-500">Name</dt><dd className="text-white">{account.name}</dd></div><div><dt className="text-slate-500">Username</dt><dd className="text-white">{account.username}</dd></div><div><dt className="text-slate-500">Account email</dt><dd className="break-all text-white">{account.email}</dd></div></dl><p className="text-sm leading-6 text-slate-400">Edit your job preferences in the Personalize tab. Your account email is used to identify your account during recovery; it has not been verified.</p><Button variant="outline" disabled={busy} onClick={()=>void logout()}><LogOut className="size-4"/>Sign out</Button></div>
        : <><div className="mt-6 flex gap-2"><Button variant={mode==='login'?'default':'outline'} disabled={busy} onClick={()=>switchMode('login')}>Sign in</Button><Button variant={mode==='register'?'default':'outline'} disabled={busy} onClick={()=>switchMode('register')}>Create account</Button></div><form key={mode} className="mt-6 space-y-4" onSubmit={submit}>
          {mode==='register'&&<label className="block space-y-2 text-sm text-slate-300"><span>Full name</span><Input name="name" autoComplete="name" required maxLength={100}/></label>}
          {['register','username','reset'].includes(mode)&&<label className="block space-y-2 text-sm text-slate-300"><span>Account email</span><Input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
          {['register','login'].includes(mode)&&<label className="block space-y-2 text-sm text-slate-300"><span>Username</span><Input name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" autoCapitalize="none" spellCheck={false}/>{mode==='register'&&<span className="text-xs text-slate-500">3–30 letters, numbers, or underscores. Not case-sensitive.</span>}</label>}
          {['username','reset'].includes(mode)&&<><p className="rounded-lg border border-white/10 p-3 text-sm leading-6 text-slate-400">Enter the private recovery code saved when you created your account. Without this code, recovery is unavailable. Email alone cannot unlock an account.</p><label className="block space-y-2 text-sm text-slate-300"><span>Recovery code</span><Input name="recoveryCode" required minLength={64} maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false}/></label></>}
          {mode!=='username'&&<label className="block space-y-2 text-sm text-slate-300"><span>{mode==='reset'?'New password':'Password'}</span><Input name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={6} maxLength={128} pattern={mode==='login'?undefined:'(?=.*[A-Za-z])(?=.*[0-9]).{6,128}'}/>{mode!=='login'&&<span className="text-xs text-slate-500">At least 6 characters with a letter and a number. Symbols are also welcome.</span>}</label>}
          {['register','reset'].includes(mode)&&<label className="block space-y-2 text-sm text-slate-300"><span>Confirm password</span><Input name="confirm" type="password" autoComplete="new-password" required minLength={6} maxLength={128}/></label>}
          {mode==='register'&&<p className="text-xs leading-5 text-slate-400">We store your name, email, username, job-search profile, and saved-role choices. Passwords are stored as salted hashes. Save the recovery code provided after signup.</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy?'Please wait…':mode==='login'?'Sign in':mode==='register'?'Create account':mode==='username'?'Recover username':'Reset password'}</Button>
        </form><div className="mt-5 flex flex-wrap gap-4 text-sm"><button disabled={busy} onClick={()=>switchMode('username')} className="text-cyan-200 underline underline-offset-4">Forgot username?</button><button disabled={busy} onClick={()=>switchMode('reset')} className="text-cyan-200 underline underline-offset-4">Forgot password?</button></div></>}
        {error&&<p role="alert" className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}
        {message&&<p role="status" className="mt-4 rounded-lg border border-cyan-300/20 p-3 text-sm text-cyan-100">{message}</p>}
      </SheetContent>
    </Sheet>
  </>;
}
