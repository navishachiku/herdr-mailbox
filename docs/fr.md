# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#installation">installation</a> · <a href="#envoyer-un-courrier">envoyer un courrier</a> · <a href="#limites">limites</a> · <a href="./guide.md">guide complet</a>
</p>

> Tu es en train d'écrire, un worker t'interrompt, le leader se réveille pour la troisième fois, et cette question de tout à l'heure, elle est passée où ?

Tu fais tourner un multi-agent workflow dans Herdr : un leader, quelques workers sur Claude Code et Codex, chacun sur sa tâche. Dès que l'un d'eux termine quelque chose, il le dépose dans la conversation du leader. Tu n'as écrit que la moitié d'une phrase et un rapport s'y glisse et part avec ; la question de décision qu'on venait de te poser est noyée par le message suivant.

**Avant**

![Sans boîte aux lettres : le rapport d'un worker est tapé dans le prompt à moitié écrit et envoyé avec lui, puis chaque rapport et chaque question réveillent le leader et la conversation se remplit](./media/demo-before.gif)

Mailbox donne une boîte aux lettres au leader. Les workers peuvent y déposer des messages ordinaires, comme des cartes postales, mais aussi des cartes de décision et des cartes de discussion auxquelles tu réponds. Les messages ordinaires arrivent en un seul lot, uniquement quand tu ne tapes pas et que le leader est libre ; les cartes attendent dans la boîte que tu y répondes à la souris.

**Après**

![Avec une boîte aux lettres : les rapports attendent dans la boîte pendant que tu écris, arrivent en un seul lot, et les questions se règlent à la souris puis repartent d'un coup](./media/demo.gif)

- **Ta zone de saisie reste à toi** — rien n'y est tapé pendant que tu écris, et rien n'arrive tant que le leader est en train de répondre.
- **Les messages arrivent ensemble** — les messages ordinaires attendent jusqu'à une minute pour partir en un seul lot et ne réveiller le leader qu'une fois ; **Send now** évite l'attente.
- **Les questions au même endroit** — les questions de décision deviennent des cartes à côté du leader ; réponds à la souris et toutes les réponses repartent en un seul lot.
- **N'importe quel agent peut écrire** — l'expéditeur n'a qu'à lancer `mailbox send`, donc Claude Code, Codex et tout agent capable d'exécuter une commande shell écrivent dans la même boîte.
- **Un accusé de réception pour chaque envoi** — chaque envoi renvoie aussitôt l'id et le statut de la lettre.
- **Elle suit le leader** — déplacer le pane, redémarrer Herdr ou vider la conversation, la boîte reste attachée au même destinataire.

## Installation

Nécessite Herdr 0.9.3 ou plus récent et Node 18 ou plus récent.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

Le reste de la configuration (la commande `mailbox`, les hooks de Claude Code, le raccourci et, si tu utilises Codex, une règle), confie-le à ton coding agent. Colle-lui ceci :

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Quand c'est fait, recharge Herdr avec `prefix+shift+r` et appuie sur `prefix+shift+m` dans le pane du leader pour ouvrir l'écran de la boîte aux lettres à côté (`prefix` vaut `ctrl+b`, sauf si tu l'as changé). Les étapes que suit l'agent sont dans [AGENT-SETUP.md](../AGENT-SETUP.md).

## Envoyer un courrier

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

Un contenu plus long se joint à la lettre sous forme de fichier (`--attach <file>`) ; la carte affiche un lien, et le fichier s'ouvre directement dans l'écran de la boîte aux lettres.

![Une carte de décision avec un rapport de tests joint : un clic sur le lien ouvre le rapport dans un cadre à l'intérieur de l'écran de la boîte](./media/attachment.png)

`--to` accepte un id de pane, un nom d'agent ou un id de boîte. Appuie sur `prefix+shift+m` dans le pane du leader pour ouvrir l'écran de la boîte à côté. Les questions de discussion, la modification et le retrait des lettres, ainsi que chaque bouton de l'écran, sont décrits dans le [guide complet](./guide.md).

## Limites

- Une question fait au plus 200 caractères et un message ordinaire au plus 500 ; un texte plus long va dans un fichier joint avec `--attach`.
- L'agent qui possède la boîte (le leader) doit être Claude Code, car la livraison attend que sa zone de saisie soit vide ; les expéditeurs peuvent être n'importe quel agent.

<details>
<summary>Avancé : fonctionnement, état, tests</summary>

### Fonctionnement

Un petit démon possède le fichier d'état et traite une requête à la fois. La CLI lui parle via un socket local et le démarre quand il ne tourne pas. L'état vit dans le répertoire d'état des plugins de Herdr, en dehors du répertoire du code du plugin, avec un numéro de version de schéma, et il est écrit sur disque avant qu'un accusé de réception ne soit renvoyé. Chaque session Herdr a son propre sous-répertoire, son démon et ses boîtes, si bien qu'une même adresse de pane dans deux sessions ne partage jamais les lettres.

| Élément | Rôle |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Le démon et les règles des lettres : accusés de réception, déduplication, modification et retrait, limites. |
| `src/identity.mjs` | Lier une boîte à un destinataire, la boucle de réconciliation, les prises en charge. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Regroupement en lots, vérification de la zone de saisie, confirmation, texte du lot. |
| `src/screen/` | L'écran de la boîte, avec les réglages et les pièces jointes affichés à l'intérieur. |
| `src/open.mjs`, `src/on-focus.mjs` | L'action `prefix+shift+m` et la réouverture de l'écran après un redémarrage de Herdr. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Les hooks de Claude Code. |

### Tests

```sh
npm test
```

Lance la vraie CLI et le vrai démon contre un faux binaire `herdr`, dans un répertoire d'état jetable.

</details>

## Licence

MIT
