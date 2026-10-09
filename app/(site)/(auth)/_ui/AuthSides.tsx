// The photo half of the auth screens, one per role (client: dancers, partner: the DJ),
// with the same crop on sign-in, sign-up and the email code.
export type AuthRole = 'client' | 'partner';

export function AuthSides({ role }: { role: AuthRole }) {
  return (
    <>
      <div className="auth-side" data-side="client" hidden={role !== 'client'} style={{ backgroundImage: "url('/photos/dancers.jpg')" }}>
        <div className="auth-side-scrim"></div>
        <div className="auth-quote">
          <div className="auth-quote-t">„Изпратихме три запитвания вечерта —<br />на сутринта имахме отговори.“</div>
          <div className="auth-quote-b">Десислава · рожден ден в Пловдив</div>
        </div>
      </div>
      <div className="auth-side" data-side="partner" hidden={role !== 'partner'} style={{ backgroundImage: "url('/photos/v1-dj-final.jpg')" }}>
        <div className="auth-side-scrim"></div>
        <div className="auth-quote">
          <div className="auth-quote-t">„Заявките идват с дата, брой гости и бюджет.<br />Аз само приемам.“</div>
          <div className="auth-quote-b">Ивайло Колев · DJ, Варна</div>
        </div>
      </div>
    </>
  );
}
