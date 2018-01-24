# KeystoneJS | Publishable Plugin
> A plugin that allows KeystoneJS items to be stored in separate databases.


### Installation

```
npm install --save git://github.com/onenorth/keystone-publishable.git#1.0.0
```


### Description

This plugin enables users to store public content in a separate database, empowering content editors to save draft progess, without it going live.

It is centered around the idea that there will be two instances of the __same KeystoneJS codebase__ deployed:

- __Content__ - The instance content editors will sign in to. Here they will manage their private content.

- __Live__ - A _read-only_ instance of the all published content, used for the actual frontend of the site.


Each instance should specify it's own `MONGO_URI` environment variable, and specify a separate connection string.

The live instance's `MONGO_URI` environment variable should match the `connectionString` configuration option to prevent firing off publishing events in the live instance.

---

### Configuration Options
> Here are the options for configuring the plugin

#### `keystone` (Required)

__Default__: `undefined`

The `keystone` npm package that your project is using.


#### `connectionString` (Required)

__Default__: `undefined`

This is the MongoDB connection string to your __live__ database.

_Note: If the `MONGO_URI` environment variable matches this value, the admin UI will be read only._


#### `liveUrl`

__Default__: `undefined`

The live base URL to display on the backend, for each model configured with a `publishable.path` field. Examples for Model configuration are below.


#### `previewUrl`

__Default__: `undefined`

The preview base URL to display on the backend, for each model configured with a `publishable.path` field. Examples for Model configuration are below.


#### `showLiveContentUrl`

__Default__: `true`

Shows a link to the read-only backend of the live site.


#### `publishCheckedByDefault`

__Default__: `false`

This will make each item have the "Publish on Save" option selected by default


#### `forcePublishRegardlessOfStatus`

__Default__: `false`

By default, a publish will only fire after a content editor saves an item while the "Publish on Save" box is checked.

For things like data imports, you might want KeystoneJS to fire off publish event, so that your content is available on the live site also.


---

### Example Usage

__`keystone.js`__

```js
const keystone = require('keystone')
const publishable = require('keystone-publishable')

// 1. Initialize KeystoneJS
keystone.init( /* ... */ )

// 2. Initialize this plugin
publishable.init({
  keystone,
  connectionString: 'mongodb://localhost/live-database',
  liveUrl: 'https://www.yoursite.com',
  previewUrl: 'https://www.yoursite.com',
  previewUrl: 'https://preview.yoursite.com',
  showLiveContentUrl: false,
  forcePublishRegardlessOfStatus: false
})

// 3. Include your Models
keystone.import('models')

// 4. Start KeystoneJS
keystone.start()
```

---

### Optional: Adding paths to help users

If you want the backend UI to provide a link to your content editor to the live and preview site, you can optionally configure each model with a path to display.

If you have a PeopleLanding model, that controls settings for the `/people` route:

```js
const PeopleLanding = new keystone.List('PeopleLanding', {
  publishable: {
    path: '/people'
  }
})

PeopleLanding.add(/* fields to add */)

PeopleLanding.register()
```

With the `liveUrl` and `previewUrl` provided in the configuration example above, the content editor will have links on the KeystoneJS item:

- Live URL: `https://www.yoursite.com/people`

- Preview URL: `https://preview.yoursite.com/people`


#### "What about dynamic URLs?"

If there is a dynamic URL, like maybe a people detail page, you can use ExpressJS syntax for your `path` configuration:

```js
const Person = new keystone.List('Person', {
  publishable: {
    path: '/people/:slug'
  }
})

Person.add(/* fields to add */)

Person.register()
```

A person with `slug` equal to `ryan-haskell` will appear as:

- Live URL: `https://www.yoursite.com/people/ryan-haskell`

- Preview URL: `https://preview.yoursite.com/people/ryan-haskell`


> Don't let your dreams be dreams.
