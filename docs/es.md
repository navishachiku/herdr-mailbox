# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#instalación">instalación</a> · <a href="#enviar-una-carta">enviar una carta</a> · <a href="#límites">límites</a> · <a href="./guide.md">guía completa</a>
</p>

> Estás escribiendo, un worker se cuela, el leader se despierta por tercera vez, y la pregunta de hace un momento, ¿adónde se fue?

Ejecutas un multi-agent workflow en Herdr: un leader con varios workers de Claude Code y Codex, cada uno en lo suyo. Cada vez que uno termina algo, lo suelta en la conversación del leader. Vas a mitad de una frase y un informe se cuela y se envía junto con ella; la pregunta de decisión que acaban de hacerte desaparece bajo el siguiente mensaje.

**Antes**

![Sin buzón: el informe de un worker se escribe dentro del prompt a medio redactar y se envía con él; luego cada informe y cada pregunta despiertan al leader y el chat se llena](./media/demo-before.gif)

Mailbox le da un buzón al leader. Además de mensajes normales, que son como postales, los workers pueden dejarte tarjetas de decisión y tarjetas de debate para que las respondas. Los mensajes normales entran en un solo lote, y solo cuando no estás escribiendo y el leader está libre; las tarjetas esperan en el buzón hasta que las respondas con el ratón.

**Después**

![Con buzón: los informes esperan en el buzón mientras escribes, llegan en un solo lote, y las preguntas se responden con el ratón y se devuelven todas de una vez](./media/demo.gif)

- **Tu cuadro de entrada sigue siendo tuyo** — no se escribe nada mientras tú escribes, y nada llega mientras el leader sigue respondiendo.
- **Los mensajes normales llegan juntos** — esperan hasta un minuto para entrar como un solo lote y despertar al leader una sola vez; **Send now** se salta la espera.
- **Las preguntas, en un solo lugar** — las preguntas de decisión se convierten en tarjetas junto al leader; responde con el ratón y envía todas las respuestas de una vez.
- **Cualquier agente puede escribir** — quien envía solo ejecuta `mailbox send`, así que Claude Code, Codex y cualquier agente que pueda ejecutar un comando de shell escriben en el mismo buzón.
- **Un acuse de recibo por cada envío** — cada envío devuelve al instante el id de la carta y su estado.
- **Sigue al leader** — mover el pane, reiniciar Herdr o limpiar la conversación mantiene el buzón con el mismo destinatario.

## Instalación

Requiere Herdr 0.9.3 o posterior y Node 18 o posterior.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

El resto de la configuración (el comando `mailbox`, los hooks de Claude Code, el atajo y, si usas Codex, una regla) déjaselo a tu coding agent. Para el comando, los hooks y la regla de Codex ejecuta `node <plugin dir>/src/setup.mjs install`; `uninstall` lo revierte. Pégale esto:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Cuando termine, recarga Herdr con `prefix+shift+r` y pulsa `prefix+shift+m` en el pane del leader para abrir la pantalla del buzón a su lado (`prefix` es `ctrl+b` salvo que lo hayas cambiado). Los pasos que sigue el agent están en [AGENT-SETUP.md](../AGENT-SETUP.md).

## Enviar una carta

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

El material más largo viaja con la carta como archivo (`--attach <file>`); la tarjeta muestra un enlace y el archivo se abre dentro de la propia pantalla del buzón.

![Una tarjeta de decisión con un informe de pruebas adjunto: al hacer clic en el enlace, el informe se abre en un cuadro dentro de la pantalla del buzón](./media/attachment.png)

`--to` acepta un id de pane, un nombre de agente o un id de buzón. Pulsa `prefix+shift+m` en el pane del leader para abrir la pantalla del buzón a su lado. Las preguntas de debate, cómo editar y retirar cartas, y cada botón de la pantalla están en la [guía completa](./guide.md).

## Límites

- Una pregunta admite hasta 200 caracteres y un mensaje normal hasta 500; el texto más largo va en un archivo con `--attach`.
- El agente dueño del buzón (el leader) tiene que ser Claude Code, porque la entrega espera a que su cuadro de entrada esté vacío; quien envía puede ser cualquier agente.

<details>
<summary>Avanzado: cómo funciona, estado, pruebas</summary>

### Cómo funciona

Un pequeño daemon es dueño del archivo de estado y atiende una petición a la vez. La CLI habla con él por un socket local y lo arranca si no está en marcha. El estado vive en el directorio de estado de plugins de Herdr, fuera del directorio del código del plugin, con una versión de esquema, y se escribe en disco antes de devolver el acuse de recibo. Cada sesión de Herdr tiene su propio subdirectorio, daemon y buzones, así que la misma dirección de pane en dos sesiones nunca comparte cartas.

| Pieza | Función |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | El daemon y las reglas de las cartas: acuses de recibo, deduplicación, editar y retirar, límites. |
| `src/identity.mjs` | Vincular un buzón a un destinatario, el bucle de reconciliación, reclamaciones. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Agrupación en lotes, comprobación del cuadro de entrada, confirmación, texto del lote. |
| `src/screen/` | La pantalla del buzón, con los ajustes y los adjuntos mostrados dentro de ella. |
| `src/open.mjs`, `src/on-focus.mjs` | La acción `prefix+shift+m` y la reapertura de la pantalla tras reiniciar Herdr. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Los hooks de Claude Code. |

### Pruebas

```sh
npm test
```

Ejecuta la CLI y el daemon reales contra un binario `herdr` falso, en un directorio de estado desechable.

</details>

## Licencia

MIT
