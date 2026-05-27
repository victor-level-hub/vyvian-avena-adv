import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";

const LOGO_WHITE = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PgogPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAyMDAxMDkwNC8vRU4iCiAiaHR0cDovL3d3dy53My5vcmcvVFIvMjAwMS9SRUMtU1ZHLTIwMDEwOTA0L0RURC9zdmcxMC5kdGQiPgo8c3ZnIHZlcnNpb249IjEuMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogd2lkdGg9IjUxMi4wMDAwMDBwdCIgaGVpZ2h0PSIxNjEuMDAwMDAwcHQiIHZpZXdCb3g9IjAgMCA1MTIuMDAwMDAwIDE2MS4wMDAwMDAiCiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ij4KCjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAuMDAwMDAwLDE2MS4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiCmZpbGw9IiNmZmZmZmYiIHN0cm9rZT0ibm9uZSI+CjxwYXRoIGQ9Ik0yNjUgMTU5MyBjLTEyNyAtNDcgLTE4MSAtMTk4IC0xMDYgLTMwMyA1MSAtNzEgMTk0IC0xMDQgMjcxIC02MwpsNiAzIDAgLTI3NSAwIC0yNzUgLTEzMyAwIC0xMzYgMCAtMTM2IC0yNSAwIC0yNSAzIDAgMTM2IDAgMTM2IDAgMjUgLTMgMjUKLTEzNiAyNSAtMTMzIDAgLTEzNiAwIC0xMzYgLTEzMCAwIC0xMzAgLTEzMyAwIC0xMzMgMjUgLTMgMjUgMCAtMjUgMCAyNSAtMjUKMCAtMjUgMyAtMTMzIDAgLTEzMyAtMTMwIDAgLTEzMCAtMjUgMCAtMjUgMyAwIDEzMCAwIDEzMCAwIDI1IC0zIDI1IC0xMzMgMApDMTExIDYxMCA5OCA2MDkgNzAgNTk3IDMgNTY4IC00OSA0OTUgLTUxIDQxNSBjLTMgLTEyMiA2MCAtMjEyIDE4OCAtMjY0IHoKTTMxMyAxNTQwIGM0NCAtMjMgNjcgLTYyIDY3IC0xMTUgMCAtNzUgLTU4IC0xMjUgLTE0NCAtMTI1IC04MiAwIC0xMzYgNDgKLTEzNiAxMjIgMCA1NyAyNiA5NyA3NyAxMjEgNDMgMjEgOTkgMTkgMTM2IC0zIHoKTTM3NiAxMDAwIGwwIC01NjAgLTcwIDAgLTcwIDAgMCA1NjAgMCA1NjAgNzAgMCA3MCAwIDAgLTU2MCB6Ck00OTYgMTAwMCBsMCAtNTYwIC03MCAwIC03MCAwIDAgNTYwIDAgNTYwIDcwIDAgNzAgMCAwIC01NjAgeiBNMjU2IDEwMDAKbDAgLTU2MCAtNzAgMCAtNzAgMCAwIDU2MCAwIDU2MCA3MCAwIDcwIDAgMCAtNTYwIHoKTTYzNSA1NTUgYzAgLTMgLTI1NCAtNSAtNTY1IC01IC0zMTEgMCAtNTY1IDIgLTU2NSA1IDAgMyAyNTQgNSA1NjUgNQozMTEgMCA1NjUgLTIgNTY1IC01IHoKTTYzNSA0NjAgYzAgLTMgLTI1NCAtNSAtNTY1IC01IC0zMTEgMCAtNTY1IDIgLTU2NSA1IDAgMyAyNTQgNSA1NjUgNQozMTEgMCA1NjUgLTIgNTY1IC01IHoKTTM5MjAgMTU1MCBjLTMwIC01IC01MCAtMzYgLTM2IC01NSAzIC01IDE5IC0xMiAzNSAtMTUgMTYgLTMgNTEgLTEyIDc4IC0yMApsMTkzIC01OCAtNjkgLTIyIGMtMzkgLTEyIC0xMTkgLTM1IC0xNzggLTUxIGwtMTA4IC0zMCA3IC0yNyA3IC0yNyAxMzMgMzcKYzE1MCA0MiAyNDUgNTcgMjY2IDQzIDE0IC05IDkzIDEyNiA4NSAxNDcgLTQgMTIgLTExNyA2NCAtMTY1IDc1IC00NSAxMQotMjI2IDE1IC0yNDggNiB6Ck0zNzUwIDE0NDIgYy0xMCAtMjUgMSAtNjMgMjcgLTk0IDExIC0xMyAzOSAtNDkgNjIgLTgwIDIzIC0zMSA0OSAtNjAgNTYKLTY0IDE1IC05IDE2IC01IC0yIDU5IGwtMTMgNDcgNDcgLTMgYzI2IC0yIDgyIC0xMCAxMjQgLTE5IDQyIC05IDgwIC0xNCA4NSAtMTEKMTMgOCAtMzEgNjQgLTYxIDc5IC0xMCA1IC00NiAxNiAtODAgMjMgLTMzIDcgLTgxIDE4IC0xMDYgMjQgbC00NiAxMCAxMAo0NiBjNiAyNiA4IDUwIDUgNTcgLTkgMjQgLTEyMiAzMCAtMTU0IDcgeiBNMzYwMCAxMjUwIGMtNjMgLTY0IC0xMTggLTE0NSAtMTQ5Ci0yMjAgbC0yMCAtNDggNDMgNSA0MyA1IDI0IDQwIGM4IDE0IDQxIDYwIDcyIDEwMiBsMTAgMTYgNiAtNjAgYzQgLTMzIDExIC05MAoxNiAtMTI3IDUgLTM3IDkgLTY4IDEwIC02OSAzIC0xMCAxMTYgNDggMTIzIDYzIDQgNyAtMyA0MyAtMTUgNzkgbC0yMiA2NiAzMQotMzggYzE3IC0yMSA0MyAtNTMgNTkgLTcyIDMzIC00MSA3MyAtNzIgNzMgLTU1IDAgMjQgLTY5IDEyNyAtMTE3IDE3OSAtNTIgNTUKLTEwNCA5NiAtMTMxIDEwNiBsLTI4IDEwIC00OSAtNTIgeiBNMzkzMCAxMTkwIGMtNTUgLTI1IC0xMTEgLTgxIC0xMjkgLTEyOQotMjkgLTc4IDQ3IC0xNjMgMTQ5IC0xNjMgNjkgMCA5OSAxOCA5OSA2MCAwIDM3IC0yOCA1NCAtNzUgNDMgLTM2IC05IC00OAotNiAtNTkgMTMgLTIyIDQwIDExIDg3IDc1IDEwNiA1MCAxNiA4MSAxMyAxMTkgLTE2IHogTTQwNDAgMTExNiBjLTQ1IC01MSAtNzIKLTEyNCAtNzIgLTE5MiAwIC01OSAxOCAtNzEgNjkgLTQ2IDE0IDcgNDAgMjEgNTcgMzEgMTggMTAgMTEwIDYxIDIwNiAxMTQgbDExMyA2Mgotc2EgOTYgLTczIDEwNSBsLTUzIDU0IC01NSAtMjMgYy0zMCAtMTMgLTU2IC0yNiAtNTggLTMwIC0yIC00IDMxIC00MCA3NCAtODAKbDc5IC03NCAtMTAyIC01NyBsLTEwMiAtNTcgLTkgMjcgYy01IDE0IC0xMSA1NCAtMTQgODggbC02IDYyIDc5IDQgYzQzIDIgODAgNgo4MyAxMCA5IDIzIC02MSA1NiAtMTE5IDU2IGwtNTUgMCAtMzUgLTM5IHogTTQxOTAgOTE3IGMtMTMgLTEzIC0yNiAtMzIgLTMwCi00NSAtNiAtMTkgLTEgLTIzIDIyIC0yMyAzMCAwIDExNCAtMzkgMTM4IC02MyA5IC0xMCAyMiAtNDggMjggLTg0IGw3IC02NSAtMzUKMTcgYy0yMCAxMCAtNTYgMjUgLTgxIDM0IEw0MjAzIDcwOCBsMzQgMzEgYzE5IDE3IDM2IDM1IDM3IDQwIDIgMTMgLTEwNCAxMDMKLTEzNCAxMDggbC0yNCA0IDAgLTUzIGMwIC03OSAtMzUgLTExNiAtMTEwIC0xMTYgLTc0IDAgLTEyMCAzNiAtMTI0IDk5IC00IDU5CjUgNzYgNzMgMTM5IDI3IDI1IDM5IDQ2IDMzIDU0IC03IDkgLTQwIDcgLTgzIC02IHogTTQzMjQgNzUyIGMtMjQgLTQzIC0zOQotMTAwIC0zOCAtMTQ4IDEgLTQ2IDEzIC01NiA1MyAtNDUgMTcgNSA2MSAxMiAxMDAgMTYgbDcwIDYgLTkwIC00MiBjLTQ5IC0yMwotMTAyIC00OSAtMTE3IC01NyBsLTI4IC0xNiA0MCAtMjggYzIyIC0xNSA0NCAtMjcgNDkgLTI3IDI2IDAgMTc3IDk0IDI0MCAxNDkKNjMgNTQgNjcgNjMgNjMgMTI4IGwtNCAxMDMgLTQ5IDIxIGMtMjcgMTIgLTUzIDIyIC01NyAyMiAtNSAwIC0xNiAtMjAgLTI2Ci00NSBsLTE3IC00NSAtNjcgLTcgbC02NiAtNyAxMiAyNiBjNiAxNCAyMyA0NiAzNiA3MSAxMyAyNSAyMSA0OSAxNyA1NCAtOSAxNAotMTExIDEwIC0xMjEgLTEzIHogTTQ0MDAgNjg2IGMtMzkgLTM4IC05MCAtMTA5IC0xMjcgLTE3MyBsLTI2IC00NiA1NCA1IGM1NCA1Cjg3IDM2IDkxIDg0IDMgMjkgMjkgNzIgNTUgOTEgMTkgMTMgMjEgMjIgMjAgNjcgbDAgNTIgLTI3IC01MCBjLTE1IC0yOCAtMjkKLTU0IC0zMiAtNTkgLTYgLTkgLTkgMzYgLTkgMTIwIDAgMzMgLTEgMzMgLTM3IC0xOCBsLTkzIC0xNTQgMCAtNTQgMCAyNiAtMTMKLTI0IHoiLz4KPC9nPgo8L3N2Zz4K";
const LOGO_GREEN = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PgogPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAyMDAxMDkwNC8vRU4iCiAiaHR0cDovL3d3dy53My5vcmcvVFIvMjAwMS9SRUMtU1ZHLTIwMDEwOTA0L0JURC9zdmcxMC5kdGQiPgo8c3ZnIHZlcnNpb249IjEuMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogd2lkdGg9IjUxMi4wMDAwMDBwdCIgaGVpZ2h0PSIxNjEuMDAwMDAwcHQiIHZpZXdCb3g9IjAgMCA1MTIuMDAwMDAwIDE2MS4wMDAwMDAiCiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ij4KCjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAuMDAwMDAwLDE2MS4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiCmZpbGw9IiMzOTU5NjMiIHN0cm9rZT0ibm9uZSI+CjxwYXRoIGQ9Ik0yNjUgMTU5MyBjLTEyNyAtNDcgLTE4MSAtMTk4IC0xMDYgLTMwMyA1MSAtNzEgMTk0IC0xMDQgMjcxIC02MwpsNiAzIDAgLTI3NSAwIC0yNzUgLTEzMyAwIC0xMzYgMCAtMTM2IC0yNSAwIC0yNSAzIDAgMTM2IDAgMTM2IDAgMjUgLTMgMjUKLTEzNiAyNSAtMTMzIDAgLTEzNiAwIC0xMzYgLTEzMCAwIC0xMzAgLTEzMyAwIC0xMzMgMjUgLTMgMjUgMCAtMjUgMCAyNSAtMjUKMCAtMjUgMyAtMTMzIDAgLTEzMyAtMTMwIDAgLTEzMCAtMjUgMCAtMjUgMyAwIDEzMCAwIDEzMCAwIDI1IC0zIDI1IC0xMzMgMApDMTExIDYxMCA5OCA2MDkgNzAgNTk3IDMgNTY4IC00OSA0OTUgLTUxIDQxNSBjLTMgLTEyMiA2MCAtMjEyIDE4OCAtMjY0IHoKTTMxMyAxNTQwIGM0NCAtMjMgNjcgLTYyIDY3IC0xMTUgMCAtNzUgLTU4IC0xMjUgLTE0NCAtMTI1IC04MiAwIC0xMzYgNDgKLTEzNiAxMjIgMCA1NyAyNiA5NyA3NyAxMjEgNDMgMjEgOTkgMTkgMTM2IC0zIHoKTTM3NiAxMDAwIGwwIC01NjAgLTcwIDAgLTcwIDAgMCA1NjAgMCA1NjAgNzAgMCA3MCAwIDAgLTU2MCB6Ck00OTYgMTAwMCBsMCAtNTYwIC03MCAwIC03MCAwIDAgNTYwIDAgNTYwIDcwIDAgNzAgMCAwIC01NjAgeiBNMjU2IDEwMDAKbDAgLTU2MCAtNzAgMCAtNzAgMCAwIDU2MCAwIDU2MCA3MCAwIDcwIDAgMCAtNTYwIHoKTTYzNSA1NTUgYzAgLTMgLTI1NCAtNSAtNTY1IC01IC0zMTEgMCAtNTY1IDIgLTU2NSA1IDAgMyAyNTQgNSA1NjUgNQozMTEgMCA1NjUgLTIgNTY1IC01IHoKTTYzNSA0NjAgYzAgLTMgLTI1NCAtNSAtNTY1IC01IC0zMTEgMCAtNTY1IDIgLTU2NSA1IDAgMyAyNTQgNSA1NjUgNQozMTEgMCA1NjUgLTIgNTY1IC01IHoKTTM5MjAgMTU1MCBjLTMwIC01IC01MCAtMzYgLTM2IC01NSAzIC01IDE5IC0xMiAzNSAtMTUgMTYgLTMgNTEgLTEyIDc4IC0yMApsMTkzIC01OCAtNjkgLTIyIGMtMzkgLTEyIC0xMTkgLTM1IC0xNzggLTUxIGwtMTA4IC0zMCA3IC0yNyA3IC0yNyAxMzMgMzcKYzE1MCA0MiAyNDUgNTcgMjY2IDQzIDE0IC05IDkzIDEyNiA4NSAxNDcgLTQgMTIgLTExNyA2NCAtMTY1IDc1IC00NSAxMQotMjI2IDE1IC0yNDggNiB6Ck0zNzUwIDE0NDIgYy0xMCAtMjUgMSAtNjMgMjcgLTk0IDExIC0xMyAzOSAtNDkgNjIgLTgwIDIzIC0zMSA0OSAtNjAgNTYKLTY0IDE1IC05IDE2IC01IC0yIDU5IGwtMTMgNDcgNDcgLTMgYzI2IC0yIDgyIC0xMCAxMjQgLTE5IDQyIC05IDgwIC0xNCA4NSAtMTEKMTMgOCAtMzEgNjQgLTYxIDc5IC0xMCA1IC00NiAxNiAtODAgMjMgLTMzIDcgLTgxIDE4IC0xMDYgMjQgbC00NiAxMCAxMAo0NiBjNiAyNiA4IDUwIDUgNTcgLTkgMjQgLTEyMiAzMCAtMTU0IDcgeiBNMzYwMCAxMjUwIGMtNjMgLTY0IC0xMTggLTE0NSAtMTQ5Ci0yMjAgbC0yMCAtNDggNDMgNSA0MyA1IDI0IDQwIGM4IDE0IDQxIDYwIDcyIDEwMiBsMTAgMTYgNiAtNjAgYzQgLTMzIDExIC05MAoxNiAtMTI3IDUgLTM3IDkgLTY4IDEwIC02OSAzIC0xMCAxMTYgNDggMTIzIDYzIDQgNyAtMyA0MyAtMTUgNzkgbC0yMiA2NiAzMQotMzggYzE3IC0yMSA0MyAtNTMgNTkgLTcyIDMzIC00MSA3MyAtNzIgNzMgLTU1IDAgMjQgLTY5IDEyNyAtMTE3IDE3OSAtNTIgNTUKLTEwNCA5NiAtMTMxIDEwNiBsLTI4IDEwIC00OSAtNTIgeiBNMzkzMCAxMTkwIGMtNTUgLTI1IC0xMTEgLTgxIC0xMjkgLTEyOQotMjkgLTc4IDQ3IC0xNjMgMTQ5IC0xNjMgNjkgMCA5OSAxOCA5OSA2MCAwIDM3IC0yOCA1NCAtNzUgNDMgLTM2IC05IC00OAotNiAtNTkgMTMgLTIyIDQwIDExIDg3IDc1IDEwNiA1MCAxNiA4MSAxMyAxMTkgLTE2IHogTTQwNDAgMTExNiBjLTQ1IC01MSAtNzIKLTEyNCAtNzIgLTE5MiAwIC01OSAxOCAtNzEgNjkgLTQ2IDE0IDcgNDAgMjEgNTcgMzEgMTggMTAgMTEwIDYxIDIwNiAxMTQgbDExMyA2Mgotc2EgOTYgLTczIDEwNSBsLTUzIDU0IC01NSAtMjMgYy0zMCAtMTMgLTU2IC0yNiAtNTggLTMwIC0yIC00IDMxIC00MCA3NCAtODAKbDc5IC03NCAtMTAyIC01NyBsLTEwMiAtNTcgLTkgMjcgYy01IDE0IC0xMSA1NCAtMTQgODggbC02IDYyIDc5IDQgYzQzIDIgODAgNgo4MyAxMCA5IDIzIC02MSA1NiAtMTE5IDU2IGwtNTUgMCAtMzUgLTM5IHogTTQxOTAgOTE3IGMtMTMgLTEzIC0yNiAtMzIgLTMwCi00NSAtNiAtMTkgLTEgLTIzIDIyIC0yMyAzMCAwIDExNCAtMzkgMTM4IC02MyA5IC0xMCAyMiAtNDggMjggLTg0IGw3IC02NSAtMzUKMTcgYy0yMCAxMCAtNTYgMjUgLTgxIDM0IEw0MjAzIDcwOCBsMzQgMzEgYzE5IDE3IDM2IDM1IDM3IDQwIDIgMTMgLTEwNCAxMDMKLTEzNCAxMDggbC0yNCA0IDAgLTUzIGMwIC03OSAtMzUgLTExNiAtMTEwIC0xMTYgLTc0IDAgLTEyMCAzNiAtMTI0IDk5IC00IDU5CjUgNzYgNzMgMTM5IDI3IDI1IDM5IDQ2IDMzIDU0IC03IDkgLTQwIDcgLTgzIC02IHogTTQzMjQgNzUyIGMtMjQgLTQzIC0zOQotMTAwIC0zOCAtMTQ4IDEgLTQ2IDEzIC01NiA1MyAtNDUgMTcgNSA2MSAxMiAxMDAgMTYgbDcwIDYgLTkwIC00MiBjLTQ5IC0yMwotMTAyIC00OSAtMTE3IC01NyBsLTI4IC0xNiA0MCAtMjggYzIyIC0xNSA0NCAtMjcgNDkgLTI3IDI2IDAgMTc3IDk0IDI0MCAxNDkKNjMgNTQgNjcgNjMgNjMgMTI4IGwtNCAxMDMgLTQ5IDIxIGMtMjcgMTIgLTUzIDIyIC01NyAyMiAtNSAwIC0xNiAtMjAgLTI2Ci00NSBsLTE3IC00NSAtNjcgLTcgbC02NiAtNyAxMiAyNiBjNiAxNCAyMyA0NiAzNiA3MSAxMyAyNSAyMSA0OSAxNyA1NCAtOSAxNAotMTExIDEwIC0xMjEgLTEzIHogTTQ0MDAgNjg2IGMtMzkgLTM4IC05MCAtMTA5IC0xMjcgLTE3MyBsLTI2IC00NiA1NCA1IGM1NCA1Cjg3IDM2IDkxIDg0IDMgMjkgMjkgNzIgNTUgOTEgMTkgMTMgMjEgMjIgMjAgNjcgbDAgNTIgLTI3IC01MCBjLTE1IC0yOCAtMjkKLTU0IC0zMiAtNTkgLTYgLTkgLTkgMzYgLTkgMTIwIDAgMzMgLTEgMzMgLTM3IC0xOCBsLTkzIC0xNTQgMCAtNTQgMCAyNiAtMTMKLTI0IHoiLz4KPC9nPgo8L3N2Zz4K";

const NAV_LINKS = [
  { label: "Home", path: "/" },
  { label: "Sobre", path: "/sobre" },
  { label: "Áreas de Atuação", path: "/areas" },
  { label: "Apoio", path: "/apoio" },
  { label: "Contacto", path: "/contacto" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-40"
        style={{
          transition: 'all 0.35s ease',
          backgroundColor: scrolled ? '#faf8f4' : 'transparent',
          boxShadow: scrolled ? '0 1px 12px rgba(0,0,0,0.08)' : 'none',
          paddingTop: scrolled ? '12px' : '20px',
          paddingBottom: scrolled ? '12px' : '20px',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img
              src={scrolled
                ? "https://media.base44.com/images/public/69d8fac37a82caf2f57459fa/a7ac084f0_logo_vyvian_avena_verde-medio.png"
                : "https://media.base44.com/images/public/69d8fac37a82caf2f57459fa/77a16034a_logo-horizontal-branco.png"
              }
              alt="Vyvian Avena Advogada"
              style={{ height: '44px', width: 'auto', objectFit: 'contain' }}
            />
          </Link>

          <div className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-body tracking-wide transition-all duration-300 hover:text-gold ${
                  location.pathname === link.path
                    ? "text-gold"
                    : scrolled
                    ? "text-forest"
                    : "text-warmwhite/90"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/contacto"
              className="ml-2 px-5 py-2 text-sm font-body tracking-wide border border-gold text-gold hover:bg-gold hover:text-warmwhite transition-all duration-300"
            >
              Consulta
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(true)}
            className={`lg:hidden transition-colors ${scrolled ? "text-forest" : "text-warmwhite"}`}
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      <div
        className={`fixed inset-0 z-50 bg-forest transition-all duration-500 flex flex-col items-center justify-center ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={() => setMenuOpen(false)}
          className="absolute top-6 right-6 text-warmwhite"
          aria-label="Fechar menu"
        >
          <X className="w-7 h-7" />
        </button>
        <div className="flex flex-col items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`font-heading text-3xl tracking-wide transition-colors hover:text-gold ${
                location.pathname === link.path ? "text-gold" : "text-warmwhite"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/contacto"
            className="mt-4 px-8 py-3 font-body text-sm tracking-widest uppercase border border-gold text-gold hover:bg-gold hover:text-warmwhite transition-all"
          >
            Consulta
          </Link>
        </div>
      </div>
    </>
  );
}