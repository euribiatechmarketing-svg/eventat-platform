import { SiteHeader } from '@/components/site/SiteHeader';

export default async function Home() {
  return (
    <>
      <SiteHeader />
      <main className="wrap" id="main"><div className="hold"><h1 className="h-page">EventAT</h1><p className="h-sub">Начална страница</p></div></main>
    </>
  );
}
