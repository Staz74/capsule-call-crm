# Capsule Call CRM

Application interne Capsule Call connectée au projet Supabase `sfetljjrbwlxigcneiib` (région Paris).

## Ce qui est prêt

- Connexion par identifiant et mot de passe, sans compte email ni courriel de réinitialisation.
- Création du premier compte administrateur par un code unique, puis comptes RH et chefs de plateau créés par l’admin.
- Attribution et modification de rôle, désactivation d’un compte et remplacement de mot de passe par l’admin.
- Mot de passe personnel modifiable depuis Paramètres.
- Données partagées dans Supabase pour les collaborateurs, candidats, onboarding, tâches, écoutes, coachings, rapports, KPI et réglages.
- Fusion des changements de collections par enregistrement pour éviter qu’une action simultanée efface les changements d’un autre utilisateur.
- Documents téléversés dans un bucket privé ; création de liens temporaires pour leur consultation.
- Règles RLS actives : un compte désactivé ne lit ni n’écrit plus les données ; les rôles ont des droits séparés.

Les identifiants internes sont transformés en identifiants techniques non distribuables par email. Les mots de passe ne sont jamais enregistrés dans la table CRM. La clé publishable présente dans `src/supabase-config.js` est conçue pour le navigateur ; aucune clé `service_role` n’est incluse côté client.

## Premier démarrage

1. Publie le contenu de ce dossier sur un hébergement HTTPS.
2. Ouvre le site : le formulaire propose la création du premier compte admin tant qu’aucun admin n’existe.
3. Entre le code d’activation à usage unique fourni séparément, ton nom affiché, ton identifiant et un mot de passe d’au moins 8 caractères.
4. Crée ensuite les accès RH et chefs de plateau depuis Paramètres.

L’activation est consommée une seule fois. Si tu perds le mot de passe d’un collaborateur, l’admin peut le remplacer sans email.

## Transférer les données locales de V32

Dans V32, ouvre **Paramètres → Exporter les données locales** et télécharge le fichier JSON. Lors de la création du premier compte admin dans cette nouvelle application, sélectionne cette sauvegarde dans le champ facultatif. Les données seront copiées dans la nouvelle base au premier chargement. La sauvegarde reste sur ton appareil jusqu’à ce que tu la choisisses.

## Publication GitHub Pages

Le workflow `.github/workflows/deploy.yml` publie automatiquement le dossier racine après un push sur `main`.

1. Crée un dépôt GitHub pour ce projet et place le contenu de ce dossier à sa racine.
2. Dans **Settings → Pages**, choisis **GitHub Actions** comme source.
3. Une fois le site publié, choisis ton domaine dans **Settings → Pages**, puis ajoute les enregistrements DNS indiqués par GitHub.
4. Le site doit être servi en HTTPS. La connexion est conçue pour l’URL Pages et un domaine personnalisé.

La connexion GitHub de cette session ne donne actuellement accès à aucun dépôt (aucun dépôt/installation retourné) ; le projet est donc préparé en local et son workflow de publication est prêt, mais il n’est pas encore poussé ni publié. Le site GitHub Pages sera accessible publiquement même si le dépôt est privé ; les données CRM, elles, restent protégées par Supabase et la connexion. Une visibilité publique du dépôt rend aussi le code de l’interface public.

## Supabase

- Référence : `sfetljjrbwlxigcneiib`
- URL API : `https://sfetljjrbwlxigcneiib.supabase.co`
- Les migrations sont conservées sous `supabase/migrations`.
- Les fonctions déployées sont sous `supabase/functions`.
- Les endpoints actifs sont `bootstrap-admin` et `manage-accounts`.

Le projet a été créé dans la région Paris. Les données opérationnelles sont stockées sous forme d’état JSON partagé pour conserver les fonctionnalités existantes de la maquette, avec une fusion concurrente par enregistrement. Une évolution vers des tables métier séparées pourra être faite plus tard si le volume ou les intégrations l’exigent.

