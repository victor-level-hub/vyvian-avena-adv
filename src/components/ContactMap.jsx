export default function ContactMap() {
  const offices = [
    {
      flag: "🇵🇹",
      region: "Cacilhas — Setúbal / Grande Lisboa",
      src: "https://www.google.com/maps?q=Rua+António+Nobre+1D,+Cacilhas,+2800-260&output=embed"
    },
    {
      flag: "🇵🇹",
      region: "Aveiro — Porto",
      src: "https://www.google.com/maps?q=Rua+Comendador+de+Sá+Couto+112,+Santa+Maria+da+Feira,+4520-192&output=embed"
    },
    {
      flag: "🇧🇷",
      region: "Barra Olímpica — Rio de Janeiro",
      src: "https://www.google.com/maps?q=Rua+Amilcar+de+Castro+40,+Barra+da+Tijuca,+Rio+de+Janeiro&output=embed"
    }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px", marginTop: "32px" }}>
      {offices.map((office, i) => (
        <div key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
            <span style={{ fontSize: "14px" }}>{office.flag}</span>
            <span style={{
              fontSize: "11px",
              fontWeight: "500",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#b8935a",
              fontFamily: "Mulish, sans-serif"
            }}>{office.region}</span>
          </div>
          <div style={{
            borderRadius: "10px",
            overflow: "hidden",
            border: "1.5px solid #d4aa70",
            boxShadow: "0 4px 18px rgba(18,48,42,0.10)"
          }}>
            <iframe
              title={office.region}
              src={office.src}
              width="100%"
              height="220"
              style={{ border: 0, display: "block" }}
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

