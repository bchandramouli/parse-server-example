Parse.Cloud.define('hello', function(req, res) {
  res.success('Hello world!');
});

Parse.Cloud.beforeSave('BeforeSaveFail', function(req, res) {
  res.error('You shall not pass!');
});

Parse.Cloud.beforeSave('BeforeSaveFailWithPromise', function (req, res) {
  var query = new Parse.Query('Yolo');
  query.find().then(() => {
   res.error('Nope');
  }, () => {
    res.success();
  });
});

Parse.Cloud.beforeSave('BeforeSaveUnchanged', function(req, res) {
  res.success();
});

Parse.Cloud.beforeSave('BeforeSaveChanged', function(req, res) {
  req.object.set('foo', 'baz');
  res.success();
});

Parse.Cloud.afterSave('AfterSaveTest', function(req) {
  var obj = new Parse.Object('AfterSaveProof');
  obj.set('proof', req.object.id);
  obj.save();
});

Parse.Cloud.beforeDelete('BeforeDeleteFail', function(req, res) {
  res.error('Nope');
});

Parse.Cloud.beforeSave('BeforeDeleteFailWithPromise', function (req, res) {
  var query = new Parse.Query('Yolo');
  query.find().then(() => {
    res.error('Nope');
  }, () => {
    res.success();
  });
});

Parse.Cloud.beforeDelete('BeforeDeleteTest', function(req, res) {
  res.success();
});

Parse.Cloud.afterDelete('AfterDeleteTest', function(req) {
  var obj = new Parse.Object('AfterDeleteProof');
  obj.set('proof', req.object.id);
  obj.save();
});

Parse.Cloud.beforeSave('SaveTriggerUser', function(req, res) {
  if (req.user && req.user.id) {
    res.success();
  } else {
    res.error('No user present on request object for beforeSave.');
  }
});

Parse.Cloud.afterSave('SaveTriggerUser', function(req) {
  if (!req.user || !req.user.id) {
    console.log('No user present on request object for afterSave.');
  }
});

Parse.Cloud.define('foo', function(req, res) {
  res.success({
    object: {
      __type: 'Object',
      className: 'Foo',
      objectId: '123',
      x: 2,
      relation: {
        __type: 'Object',
        className: 'Bar',
        objectId: '234',
        x: 3
      }
    },
    array: [{
      __type: 'Object',
      className: 'Bar',
      objectId: '345',
      x: 2
    }],
    a: 2
  });
});

Parse.Cloud.define('bar', function(req, res) {
  res.error('baz');
});

Parse.Cloud.define('requiredParameterCheck', function(req, res) {
  res.success();
}, function(params) {
  return params.name;
});

Parse.Cloud.define('echoKeys', function(req, res){
  return res.success({
    applicationId: Parse.applicationId,
    masterKey: Parse.masterKey,
    javascriptKey: Parse.javascriptKey
  })
});

Parse.Cloud.define('createBeforeSaveChangedObject', function(req, res){
  var obj = new Parse.Object('BeforeSaveChanged');
  obj.save().then(() => {
    res.success(obj);
  })
})


/**
 * From here...
 * New code added for inventory processing
 */

// Initialize the Stripe and Mailgun Cloud Modules
var Stripe = require('stripe')("sk_test_3n3xj9zbj6hOkEhngx7uITeH");
var Mailgun = require('mailgun-js')({apiKey: "key-afab485a6a9bf921692f83c3c1d03b56",
                                     domain: "sandboxd6cc36b660184159bc67c3f403466981.mailgun.org"});

function stringifyHomeInventory(homeInv, price) {
  var orderStringified;
  for (var i = 0 ; i < homeInv.length; i++) {
       orderStringified = orderStringified +
        homeInv[i].get("name") +
        " * " +
        homeInv[i].get("homeCount").toString() +
        " @ $" +
        homeInv[i].get("farmInv").get("rate").toString() +
        "/" +
        homeInv[i].get("farmInv").get("unit") +
        "\n\n";
  }

  orderStringified = orderStringified + "\n" + "Total Price: $" + price.toString() + "\n";

  return orderStringified;
}

function getHomeInventoryPrice(homeInv) {
  var price = 0;

  for (var i = 0 ; i < homeInv.length; i++) {
    price = price + homeInv[i].get("farmInv").get("rate") * homeInv[i].get("homeCount");
  }
  return price;
}

/**
 * Purchase an item from the Parse Store using the Stripe
 * Cloud Module.
 *
 *  Expected input (in request.params):
 *   homeId         : String, to retrieve the home details
 *   cardToken      : String, the credit card token returned to the client from Stripe
 *
 * Also, please note that on success, "Success" will be returned.
 */
Parse.Cloud.define('purchaseInventory', function(request, response) {
  /**
   * Ensure only Cloud Code can get access by using the master key.
   * Parse.Cloud.useMasterKey();
   * XXX - this has been changed to useMasterKey: true as an option to each Parse.Query!
   */

  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  var home, order, orderString;
  var price = 0;

  var cardToken = request.params.cardToken;

  // We start in the context of a promise to keep all the
  // asynchronous code consistent. This is not required.
  Parse.Promise.as().then(function() {

    var homeQuery = new Parse.Query('Homes');
    // Find the item to purchase.
    homeQuery.equalTo("objectId", request.params.homeId);
    homeQuery.include("homeInventory");
    homeQuery.include("homeInventory.farmInv");

    /**
     * Find the resuts. We handle the error here so our
     * handlers don't conflict when the error propagates.
     * Notice we do this for all asynchronous calls since we
     * want to handle the error differently each time.
     */
    home = homeQuery.find().then(null, function(error) {
      console.log("could not find the home rec", error);
    });

    return homeQuery.first().then(null, function (error) {
        return Parse.Promise.error('DB query failed? - The home record query failure.');
    });

    //.then(null, function(error) {
    // return Parse.Promise.error('DB query failed? - The home record query failure.');
    // });
  }).then(function(result) {
    // Make sure we found an item.
    if (!result) {
      return Parse.Promise.error('Sorry, the home record is no longer available.');
    }

    home = result;
    var inventory = home.get("homeInventory");
    price = getHomeInventoryPrice(inventory);
    orderString = stringifyHomeInventory(inventory, price);


    // We have items left! Let's create our order item before
    // charging the credit card (just to be safe).
    order = new Parse.Object('Order');
    order.set('name', home.get("owner"));
    order.set('email', home.get("email"));
    order.set('orderString', orderString);
    order.set('address', home.get("address"));
    order.set('fulfilled', false);
    order.set('charged', false); // set to false until we actually charge the card

    // Create new order
    return order.save().then(null, function(error) {
      // This would be a good place to replenish the quantity we've removed.
      // We've ommited this step in this app.
      return Parse.Promise.error('An error has occurred. Your credit card was not charged.');
    });

  }).then(function(order) {
    // Now we can charge the credit card using Stripe and the credit card token.

    return Stripe.charges.create({
      amount: price * 100, // express dollars in cents
      currency: 'usd',
      card: cardToken
    }).then(null, function(error) {
      console.log('Charging with stripe failed. Error: ' + error);
      return Parse.Promise.error('An error has occurred. Your credit card was not charged.');
    });

  }).then(function(purchase) {
    // Credit card charged! Now we save the ID of the purchase on our
    // order and mark it as 'charged'.

    order.set('stripePaymentId', purchase.id);
    order.set('charged', true);

    // Save updated order
    return order.save().then(null, function(error) {
      /**
       * This is the worst place to fail since the card was charged but the order's
       * 'charged' field was not set. Here we need the user to contact us and give us
       * details of their credit card (last 4 digits) and we can then find the payment
       * on Stripe's dashboard to confirm which order to rectify.
       */

      console.log("order save screwup \n");

      return Parse.Promise.error('A critical error has occurred with your order. Please ' +
                                 'contact reachorchardview@gmail.com at your earliest convinience. ');
    });

  }).then(function(order) {
    // Credit card charged and order item updated properly!
    // We're done, so let's send an email to the user.

    // Generate the email body string.
    var body = "We've received and processed your order for the following items: \n\n" +
               orderString + "\n";

    body += "Shipping Address: \n" +
            home.get("owner") + "\n" +
            home.get("address") + "\n" +
            "Mountain View, CA " + home.get("zip") + "\n" +
            "United States, " + "\n" +
            "\nWe will deliver your item by 2 pm today. " +
            "Let us know if you have any questions!\n\n" +
            "Thank you,\n" +
            "The FarmView Team";

    // Send the email.
    return Mailgun.messages().send({
      from: 'reachorchardview@gmail.com',
      // to: home.get("email"),
      to: 'reachorchardview@gmail.com', // hack - the mailgun sandbox only allows approved emails
      cc: 'reachorchardview@gmail.com',
      subject: 'Your farmer\'s market inventory was processed!',
      text: body
    }).then(null, function(error) {

      console.log("email send failure", error);

      return Parse.Promise.error('Your purchase was successful, but we were not able to ' +
                                 'send you an email. Contact us at reachorchardview@gmail.com if ' +
                                 'you have any questions.');
    });

  }).then(function() {
    // And we're done!
    response.success('Success');

  /**
   * Any promise that throws an error will propagate to this handler.
   * We use it to return the error from our Cloud Function using the
   * message we individually crafted based on the failure above.
   */
  }, function(error) {

    response.error(error);

  });
});



/**
 * Send user code to the registered email.
 *
 *  Expected input (in request.params):
 *   email     : User's email
 *   code      : Code to be sent in the email
 *
 * Simple email send function - on success, "Success" will be returned.
 */
Parse.Cloud.define('verifyEmail', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.

  var userEmail = request.params.userEmail;
  var userCode = request.params.userCode;

  console.log("in verify email", request.toString());

  // Let's send an email to the user.

  // Generate the email body string.
  var body = "Hi,\n\n" +
             "The confirmation code for your FarmView App registration is: " +
             userCode + "\n\n";

  body += "Thank you,\n" +
          "The FarmView Team";

  // Send the email.
  Mailgun.messages().send({
    from: 'reachorchardview@gmail.com',
    //to: home.get("email"),
    to: userEmail, // hack - the mailgun sandbox only allows approved emails
    cc: 'reachorchardview@gmail.com',
    subject: 'Your FarmView registration code!',
    text: body
  }).then(function() {
    response.success('Success');
  }, function(error) {
    console.log("email send failure", error);
    response.error(error);
  });
});


var Influx = require('influx');
var influxDbUrl = 'http://ec2-54-88-255-188.compute-1.amazonaws.com:8086/${myDB}';
var testDB = 'test1';
var orderDB = 'orderDB';
var priceDB = 'priceDB'

var invCostSeriesName = "invCost";
var totalCostSeriesName = "totalCost";
var invPriceSeriesName = "invPricing";

var sinSeriesName = 'sin'

var client = Influx({
      // or single-host configuration
      host : 'ec2-54-88-255-188.compute-1.amazonaws.com',
      port : 8086, // optional, default 8086
      protocol : 'http', // optional, default 'http'
      username : 'root',
      password : 'root',
      database : testDB});

/**
 * Log a time series entry in the InfluxDB.
 *
 *  Expected input (in request.params):
 *   value     : Value to be recorded
 *
 * Simple record value function - on success, "Success" will be returned.
 */
Parse.Cloud.define('recordTSVal', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  var sinVal = request.params.val;

  var point = {value: sinVal};

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
  client.writePoint(sinSeriesName, point, null, {db: testDB},
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        response.success('Success');
      }
  });
});

/**
 * Log an order value in the InfluxDB.
 *
 *  Expected input (in request.params):
 *   cost         : cost for the order
 *   home_id      : home tag
 *   farm_id      : farm tag
 *   inventory_id : inventory tag
 *
 * Simple cost record function - on success, "Success" will be returned.
 */
Parse.Cloud.define('recordInvCost', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  
  var cost = request.params.cost;
  var homeId = request.params.homeId;
  var farmId = request.params.farmId;
  var invId = request.params.invId;
  var point = {value: cost} 

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
  client.writePoint(invCostSeriesName,
    point, 
    {homeId : homeId, farmId: farmId, invId: invId},
    {db: orderDB},
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        console.log(resp);
        response.success('Success');
      }
  });
});

/**
 * Log total order value in the InfluxDB.
 *
 *  Expected input (in request.params):
 *   cost         : cost for the order
 *   home_id      : home tag
 *   farm_id      : farm tag
 *   inventory_id : inventory tag
 *
 * Simple cost record function - on success, "Success" will be returned.
 */
Parse.Cloud.define('recordTotalCost', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  
  var cost = request.params.cost;
  var homeId = request.params.homeId;
  var farmId = request.params.farmId;
  var point = {value: cost} 

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
  client.writePoint(totalCostSeriesName,
    point, 
    {homeId : homeId, farmId: farmId, invId: 'all'},
    {db: orderDB},
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        response.success('Success');
      }
  });
});

/**
 * Log a pricing value in the InfluxDB.
 *
 *  Expected input (in request.params):
 *   price        : price of the inventory
 *   farm_id      : farm tag
 *   inventory_id : inventory tag
 *
 * Simple price record function - on success, "Success" will be returned.
 */
Parse.Cloud.define('recordInvPrice', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  
  var price = request.params.price;
  var farmId = request.params.farmId;
  var invId = request.params.invId;
  var point = {value: price} 

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
  client.writePoint(invPriceSeriesName,
    point, 
    {farmId: farmId, invId: invId},
    {db: priceDB},
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        response.success('Success');
      }
  });
});


/**
 * Query the time series entries from the InfluxDB.
 *
 * Returns a set of data points in the last 1 hour
 */
Parse.Cloud.define('queryTSVal', function(request, response) {
  var query = 'SELECT * FROM ' + sinSeriesName + 
    ' WHERE time > now() - 1h';

  client.query(query,
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        response.success(resp);
      }
  });
});


/**
 * Query the cost entries from the InfluxDB.
 *  Expected input (in request.params):
 *   farm_id      : farm tag
 *
 * Returns a set of data points in the last 1 hour
 */
Parse.Cloud.define('queryInvCost', function(request, response) {

  var farmId = request.params.farmId;

  var query = 'SELECT  FROM ' + invCostSeriesName +
   '; SELECT AVG(VALUE) as avgvalue from' + invCostSeriesName + ' WHERE farmId = ' + farmId;

  client.query(query,
    function(err, resp) {
      if (err) {
        console.log("error writing to DB", err);
        response.error(err);
      } else {
        response.success(resp);
      }
  });
});