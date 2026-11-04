# Lecture de notes

Petit jeu (web app installable sur iPhone) pour apprendre à lire les notes en clé de sol et en clé de fa.

- 10 niveaux : clés de sol / fa, lignes supplémentaires, dièses et bémols, grand portée, chrono de plus en plus court.
- Onglet Accords : 10 niveaux de lecture d'accords (majeurs, mineurs, renversements, septièmes), réponse par le nom de l'accord.
- Mode libre : notes, accords, ou les deux mélangés.
- Réponse par noms de notes, mini clavier de piano, ou en jouant sur un vrai piano (l'iPhone écoute au micro ; écran de test et d'accordage dans les Réglages).
- Statistiques et entraînement ciblé sur les notes difficiles.
- Fonctionne hors-ligne une fois ajoutée à l'écran d'accueil (Safari → Partager → Sur l'écran d'accueil).

HTML/CSS/JS sans dépendance ni build. Tests : ouvrir `tests.html`.

Après une modification, incrémenter `CACHE` dans `sw.js` pour que l'iPhone récupère la nouvelle version.
