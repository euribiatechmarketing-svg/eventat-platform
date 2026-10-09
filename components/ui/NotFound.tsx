// The "page not found" body shared by every area (new copy — on the approval list).
import Link from 'next/link';

export function NotFoundBody({ home = '/', homeLabel = 'Към началото', inShell = false }: { home?: string; homeLabel?: string; inShell?: boolean }) {
  // Inside a panel the shell already holds the main landmark (#main).
  return (
    <div className="ui-notfound" role={inShell ? undefined : 'main'} id={inShell ? undefined : 'main'}>
      <p className="ui-notfound-code"><span className="num">404</span></p>
      <h1 className="ui-notfound-t">Страницата не е намерена</h1>
      <p className="ui-notfound-d">Връзката може да е непълна или страницата вече не съществува.</p>
      <Link className="btn btn--primary" href={home}>{homeLabel}</Link>
    </div>
  );
}
