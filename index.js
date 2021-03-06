const path = require('path')

module.exports = {

  init: ({
    keystone,
    connectionString,
    liveUrl,
    previewUrl,
    showLiveContentUrl,
    publishCheckedByDefault,
    forcePublishRegardlessOfStatus
  }) => {
    let dbConnection
    const thisConnection = process.env.MONGO_URI || keystone.get('mongo')
    const isLiveDatabase = thisConnection === connectionString

    keystone.List.prototype.oldRegister = keystone.List.prototype.register

    const connectToDatabase = (connectionString) =>
      new Promise((resolve, reject) => {
        if (dbConnection) {
          resolve(dbConnection)
        } else {
          // Keep connection alive longer to prevent timeout issues
          const option = {
            server: {
              socketOptions: {
                keepAlive: 300000,
                connectTimeoutMS: 30000
              }
            },
            replset: {
              socketOptions: {
                keepAlive: 300000,
                connectTimeoutMS: 30000
              }
            }
          }

          const db = keystone.mongoose.createConnection(connectionString, option)
          db.on('open', err => {
            if (err) {
              reject(err)
            } else {
              dbConnection = db
              resolve(dbConnection)
            }
          })

          db.on('close', () => { dbConnection = undefined })
        }
      })

    keystone.List.prototype.register = function () {
      // Only add fields and hooks if List is not inheriting from
      // another List to avoid hooks from being run twice.
      if (this.options.inherits) {
        this.oldRegister()
        return
      }

      // Make lists on live site view only
      (['noedit', 'nocreate', 'nodelete']).forEach(key => {
        this.options[key] = this.options[key] || isLiveDatabase
      })

      const urlPath = this.options.publishable && this.options.publishable.path
      const publishByDefault = this.options.publishable && this.options.publishable.publishByDefault
      const noUnpublish = this.options.publishable && this.options.publishable.noUnpublish
      const trackPublishDate = this.options.publishable && this.options.publishable.trackPublishDate

      addFields(this, { urlPath, publishByDefault, noUnpublish, trackPublishDate })

      this.oldRegister()

      addHooks(this, { urlPath, publishByDefault, trackPublishDate })
    }

    const addFields = (list, {urlPath, publishByDefault, noUnpublish, trackPublishDate}) => {
      list.add(
        { heading: 'Publishing Workflow' },
        {
          // Statuses
          publish__status: {
            label: 'Publishing Status',
            type: keystone.Field.Types.Select,
            options: [
              { value: 'unpublished', label: 'Unpublished' },
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft' }
            ],
            default: 'unpublished',
            noedit: true,
            index: true
          }
        }
      )
      list.schema.index({ publish__status: 1 })

      if (trackPublishDate) {
        list.add({
          publish__date: {
            type: keystone.Field.Types.Date,
            label: 'Published Date',
            utc: true
          },
          publish__displayDate: {
            type: keystone.Field.Types.Text,
            label: 'Displayed Date',
            note: 'Use this field to override the autogenerated formatted Published Date (MM/DD/YYYY) on the website. The website will display the date exactly as entered above.'
          }
        })
        list.schema.index({ publish__date: -1 })
        list.schema.index({ publish__date: 1 })
      }

      list.add({
        // URLs
        publish__previewUrl: {
          label: 'Preview URL',
          type: keystone.Field.Types.Url,
          noedit: true,
          hidden: isLiveDatabase || !urlPath || previewUrl === undefined,
          dependsOn: { publish__status: ['unpublished', 'draft'] }
        },
        publish__liveUrl: {
          label: 'Live URL',
          type: keystone.Field.Types.Url,
          noedit: true,
          hidden: isLiveDatabase || !urlPath || liveUrl === undefined,
          dependsOn: { publish__status: ['published'] }
        },
        publish__contentUrl: {
          label: 'Content URL',
          type: keystone.Field.Types.Url,
          noedit: true,
          hidden: isLiveDatabase || (showLiveContentUrl === false) || liveUrl === undefined,
          dependsOn: { publish__status: ['published'] }
        },
        // Actions
        publish__publishOnSave: {
          label: 'Publish on save',
          type: Boolean,
          default: (publishCheckedByDefault === true || publishByDefault === true),
          hidden: isLiveDatabase
        },
        publish__unpublishOnSave: {
          label: 'Unpublish on save',
          type: Boolean,
          dependsOn: { publish__status: 'published', publish__publishOnSave: false },
          hidden: isLiveDatabase || noUnpublish
        },
        publish__rollbackOnSave: {
          label: 'Rollback draft to live version',
          type: Boolean,
          dependsOn: { publish__status: 'draft', publish__publishOnSave: false },
          hidden: isLiveDatabase
        }
      })
    }

    const addHooks = (list, { urlPath, publishByDefault, trackPublishDate }) => {
      const collectionName = list.options.schema.collection

      list.schema.pre('save', function (next) {
        const doc = this

        const getShouldPublish = () => {
          if (forcePublishRegardlessOfStatus && (doc.publish__status === 'published' || doc.publish__publishOnSave)) {
            return true
          }

          if (doc.saveWithSameStatus) {
            return doc.publish__status === 'published'
          }
          // If document is new, just create and dont publish.
          // When the document is saved, then it will be published if
          // publishOnSave is enabled.
          return doc.isNew
            ? false
            : doc.publish__publishOnSave
        }

        const shouldPublish = getShouldPublish()
        const shouldUnpublish = doc.publish__unpublishOnSave
        const shouldRollback = doc.publish__rollbackOnSave

        doc.publish__publishOnSave = (publishCheckedByDefault === true || publishByDefault)
        doc.publish__unpublishOnSave = false
        doc.publish__rollbackOnSave = false
        if (shouldPublish) {
          doc.publish__status = 'published'

          if (liveUrl) {
            doc.publish__contentUrl = getContentUrl(doc)
            if (urlPath) {
              doc.publish__liveUrl = getLiveUrl(urlPath, doc)
            }
          }

          publish(doc)
            .then(next)
            .catch(createCatchHandler(next))
        } else if (shouldRollback) {
          getPublishedDocument(doc)
            .then(publishedDoc => {
              Object.keys(publishedDoc)
                .map(key => { doc[key] = publishedDoc[key] })
            })
            .then(next)
            .catch(createCatchHandler(next))
        } else {
          if (previewUrl && urlPath) {
            doc.publish__previewUrl = getPreviewUrl(urlPath, doc)
          }

          if (shouldUnpublish) {
            doc.publish__status = 'unpublished'

            unpublish(doc)
              .then(next)
              .catch(createCatchHandler(next))
          } else {
            checkIfDifferentThanLive(doc)
              .then((differsFromLive) => {
                if (differsFromLive) {
                  doc.publish__status = 'draft'
                }
              })
              .then(next)
              .catch(createCatchHandler(next))
          }
        }
      })

      const getContentUrl = (doc) => {
        const id = doc._doc._id
        return `${liveUrl}/keystone/${list.path}/${id}`
      }

      const getUrl = (baseUrl) => (urlPath, doc) => {
        const regex = /:([\w\-\.]+)/g
        const newUrlPath = urlPath.replace(regex, (match, param) => doc[param])

        return path.join(baseUrl, newUrlPath)
      }

      const getLiveUrl = getUrl(liveUrl)

      const getPreviewUrl = (urlPath, doc) =>
        doc.slug
          ? getUrl(previewUrl)(urlPath, doc)
          : 'Save to generate preview link'

      const performDatabaseOperation = (fn) => (doc) =>
        connectToDatabase(connectionString)
          .then(db => fn(db, doc))

      const getPublishedDoc = (doc, db) =>
        db.collection(collectionName)
          .findOne({ '_id': doc._id })

      const publish = performDatabaseOperation((db, doc) =>
        getPublishedDoc(doc, db)
          .then(_doc => (_doc == null)
            ? db.collection(collectionName)
                .insert(doc)
                .then(response => db)
            : db.collection(collectionName)
                .update({ '_id': doc._id }, doc)
                .then(response => db)
          )
      )

      const unpublish = performDatabaseOperation((db, doc) =>
        getPublishedDoc(doc, db)
          .then(_doc => (_doc == null)
            ? Promise.resolve(db)
            : db.collection(collectionName)
                .remove({ '_id': doc._id })
                .then(response => db)
          )
      )

      const getPublishedDocument = performDatabaseOperation((db, doc) =>
        getPublishedDoc(doc, db)
      )

      const checkIfDifferentThanLive = performDatabaseOperation((db, doc) =>
        getPublishedDoc(doc, db)
        .then(_doc => (_doc == null)
          ? false
          : objectsDiffer(doc, _doc)
        )
      )

      const createCatchHandler = next => error => {
        console.warn('Error with Database Operation: ', error)
        next(new Error('There was an error saving. Please try again.'))
      }

      const objectsDiffer = (doc, _doc) => {
        const current = doc.toObject()
        const live = _doc
        return !objectEquals(current, live)
      }

      const objectEquals = (x, y) => {
        if (x === null || x === undefined || y === null || y === undefined) {
          return x === y
        }
        // after this just checking type of one would be enough
        if (x.constructor !== y.constructor) {
          return false
        }
        // if they are functions, they should exactly refer to same one (because of closures)
        if (x instanceof Function) {
          return x === y
        }
        // if they are regexps, they should exactly refer to same one (it is hard to better equality check on current ES)
        if (x instanceof RegExp) {
          return x === y
        }
        if (x === y || x.valueOf() === y.valueOf()) {
          return true
        }
        if (Array.isArray(x) && x.length !== y.length) {
          return false
        }

        // if they are dates, they must had equal valueOf
        if (x instanceof Date) {
          return false
        }

        // if they are strictly equal, they both need to be object at least
        if (!(x instanceof Object)) {
          return false
        }
        if (!(y instanceof Object)) {
          return false
        }

        const excludeFields = item => {
          const excludedFields = {
            updatedAt: true
          }

          return !excludedFields[item]
        }

        // recursive object equality check
        const currentKeys = Object.keys(x).filter(excludeFields)
        const liveKeys = Object.keys(y).filter(excludeFields)

        const hasSameKeys = liveKeys.every(key => currentKeys.indexOf(key) !== -1)

        return hasSameKeys && liveKeys.every(key => objectEquals(x[key], y[key]))
      }
    }

    // don't start integration until after connection is set to avoid mass connection creation
    return connectToDatabase(connectionString)
  }
}
