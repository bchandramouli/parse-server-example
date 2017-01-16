
/**
 * From here...
 * New code added for inventory processing
 */
// Initialize the Stripe and Mailgun Cloud Modules
var Stripe = require('stripe')("sk_test_3n3xj9zbj6hOkEhngx7uITeH");
var Mailgun = require('mailgun-js')({apiKey: "key-afab485a6a9bf921692f83c3c1d03b56",
                                     domain: "sandboxd6cc36b660184159bc67c3f403466981.mailgun.org"});

var FORAGE_EMAIL = 'reachforagers@gmail.com';
var ORCHVIEW_EMAIL = 'reachorchardview@gmail.com';

function stringifyHomeInventory(order, price) {
  var orderStringified = "";

  var hInvList = order.get("homeInventories");
    
  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    var fInv = hInv.get("farmInv");

     orderStringified = orderStringified +
      fInv.get("name") +
      " * " +
      hInv.get("homeCount").toString() +
      " @ $" +
      fInv.get("rate").toString() +
      "/" +
      fInv.get("unit") +
      "\n\n";
  }
  orderStringified = orderStringified + "\n" + "Total Price: $" + price.toString() + "\n";

  return orderStringified;
}

function getHomeInventoryPrice(order) {
  var price = 0;
  var hInvList = order.get("homeInventories");

  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    var fInv = hInv.get("farmInv");

    price = price + fInv.get("rate") * hInv.get("homeCount");
  }
  
  return price;
}

/*
 * Example of parse promise array!
 *
function fetchCompleteOrder(order) {
  var promise_array = [];
  var orderPerFarms = order.get("orderFarms");

  for (var i = 0 ; i < orderPerFarms.length; i++) {
    var hInvList = orderPerFarms[i].get("homeInventories");

    for (var j = 0 ; j < hInvList.length; j++) {
      var hInv = hInvList[j];
      var fInv = hInv.get("farmInv");
      promise_array.push(fInv.fetch());
    }
  }
  
  return Parse.Promise.when(promise_array);
}
*/

/**
 * Purchase an item from the Parse Store using the Stripe
 * Cloud Module.
 *
 *  Expected input (in request.params):
 *   orderId         : String, to retrieve the order details
 *   savedCard      : Boolean, previous card => customerId, new card => cardToken
 *      - customerId     : String, Stripe Opaque data, for a previously used card
 *      - cardToken      : String, the credit card token returned to the client from Stripe
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
  var order, orderString; 
  var price = 0;
  var customerId = "Forage_dummy";
  var cardToken = "Forage_dummy";
  var custEmail = FORAGE_EMAIL;

  var orderId = request.params.orderId;
  var savedCard = request.params.savedCard;
  if (savedCard) {
    customerId = request.params.customerId;
  } else {
    cardToken = request.params.cardToken;
  }

  // We start in the context of a promise to keep all the
  // asynchronous code consistent. This is not required.
  Parse.Promise.as().then(function() {

    var orderQuery = new Parse.Query('Order');
    // Find the item to purchase.
    orderQuery.equalTo("objectId", orderId);
    orderQuery.include("homeInventories");
    orderQuery.include("homeInventories.farmInv");

    /**
     * Find the resuts. We handle the error here so our
     * handlers don't conflict when the error propagates.
     * Notice we do this for all asynchronous calls since we
     * want to handle the error differently each time.
     */
    order = orderQuery.find().then(null, function(error) {
      console.log("could not find the order rec", error);
    });

    return orderQuery.first().then(null, function (error) {
        console.log("could not find the order", error);
        return Parse.Promise.error('DB query failed? - Order query failure.');
    });

  }).then(function(result) {
    // Make sure we found an item.
    if (!result) {
      return Parse.Promise.error('Sorry, the order is no longer available.');
    }
    order = result;

    /**
     *
     *  Recompute the price!
     *     - we cannot gaurantee the save could have happened in time. :( Safer to recompute!
     */
    price = getHomeInventoryPrice(order);
    orderString = stringifyHomeInventory(order, price);

    custEmail = order.get("homeEmail");

    if (savedCard) {
      // Charge the customer again, retrieve the customer ID!
      return Stripe.charges.create({
          amount: price * 100, // express dollars in cents
          currency: "usd",
          customer: customerId, // Previously stored, then retrieved
          metadata: {'order_id': orderId} // Save orderId, to correlate all orders for a user
        }).then(null, function(error) {
          console.log('Charging with stripe failed. Error: ' + error);
          return Parse.Promise.error('An error has occurred. Your credit card was not charged.');
        });
    } else {

      var custDesc = 'Customer for ' + custEmail;

      // Create a new Stripe customer!
      return Stripe.customers.create({
        source: cardToken,
        description: custDesc,
        email: custEmail // Save the customer's email
      }).then(function(customer) {
        // Save the Id!
        customerId = customer.id;

        return Stripe.charges.create({
          amount: price * 100, // express dollars in cents
          currency: "usd",
          customer: customerId,
          metadata: {'order_id': orderId} // Save orderId, to correlate all orders for a user
          }).then(null, function(error) {
            console.log('Charging with stripe failed. Error: ' + error);
            return Parse.Promise.error('An error has occurred. Your credit card was not charged.');
          });
        });
    }
  }).then(function(purchase) {

    // Credit card charged! Now we save the ID of the purchase on our
    // order and mark it as 'charged'.
    order.set('customerId', customerId);
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

      return Parse.Promise.error('A critical error has occurred with your order #' + orderId +
                                 ' . Please contact ' + FORAGE_EMAIL + '.');
    });

  }).then(function(order) {

    // Credit card charged and order item updated properly!
    // We're done, so let's send an email to the user.

    // Generate the email body string.
    var body = "We've received and processed your order" + orderId + " for the following items: \n\n" +
               orderString + "\n";

    body += "Shipping Address: \n" +
            order.get("homeName") + "\n" +
            order.get("homeAddress") + "\n" +
            "\nWe will deliver your order by 6 pm today. " +
            "Thank you for shopping with Forage!\n\n" +
            "Packing with care,\n" +
            "Foragers";

    // Send the email.
    return Mailgun.messages().send({
      from: FORAGE_EMAIL,
      // to: home.get("email"),
      to: FORAGE_EMAIL, // custEmail - temp hack - the mailgun sandbox only allows approved emails
      // cc: FORAGE_EMAIL,
      bcc: ORCHVIEW_EMAIL,
      subject: 'Your farmer\'s market order' + orderId + ' is ready!',
      text: body
    }).then(null, function(error) {

      console.log("email send failure", error);

      return Parse.Promise.error('Your purchase was successful, but we were not able to ' +
                                 'send you an email. Please contact us at ' + FORAGE_EMAIL + '.');
    });

  }).then(function() {
    // And we're done - send the customer Id back!
    response.success(customerId);

    /**
     * Any promise that throws an error will propagate to this handler.
     * We use it to return the error from our Cloud Function using the
     * message we individually crafted based on the failure above.
     */
  }, function(error) {

    console.log("@error catchAll: ", error.toString());

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

  // Let's send an email to the user.
  
  // Generate the email body string.
  var body = "Hi,\n\n" +
             "The confirmation code for your Forage App is: " +
             userCode + "\n\n";

  body += "Thank you,\n" +
          "Foragers";

  // Send the email.
  Mailgun.messages().send({
    from: FORAGE_EMAIL,
    //to: home.get("email"),
    to: userEmail, // hack - the mailgun sandbox only allows approved emails
    cc: FORAGE_EMAIL,
    subject: 'Your Forage registration code!',
    text: body
  }).then(function() {
    response.success('Success');
  }, function(error) {
    console.log("email send failure", error);
    response.error(error);
  });
});

var Influx = require('influx');
var assert = require('assert');
var influxDbUrl = 'http://ec2-54-210-219-155.compute-1.amazonaws.com:8086/${myDB}';
var seriesName = 'sin';
var myDB = 'test1';
var orderPerItem = "orderPerItemSeries";
var orderTotal = "orderTotalSeries";

const client = new Influx.InfluxDB({
      // or single-host configuration
      host : 'ec2-54-210-219-155.compute-1.amazonaws.com',
      port: 8086,
      database : myDB,
      schema: [{
          measurement: orderPerItem,
          fields: {
            price: Influx.FieldType.FLOAT,
            qtyOrdered: Influx.FieldType.FLOAT,
            available: Influx.FieldType.FLOAT
          },
          tags: [
          'homeId','farmId','itemId', 'unit'
          ]
        }]
      });



function writeToTotalSeries(homeEmail, totalPrice, checkOutTime) {
/*
 client.writePoint(orderTotalseries, point, {homeId: homeEmail}, {db: myDB},
    function(err, resp) {
      if (err) {
        console.log("error writing order total to DB", err);
        response.error(err);
      } else {
        response.success('Success writing order total');
      }
  });
  */

  client.writePoints([{
    measurement: orderTotal,
    tags: { homeId: homeEmail},
    fields: {price: totalPrice},
    timestamp: checkOutTime
  }]);
}

function writeToItemSeries(homeEmail, farmName, itemName, itemQty, itemUnit, itemPrice, itemTotAvail, checkOutTime) {
  client.writePoints([{
    measurement: orderPerItem,
    tags: { homeId: homeEmail, farmId: farmName, itemId: itemName, unit: itemUnit},
    fields: { qtyOrdered: itemQty, price: itemPrice, available: itemTotAvail},
    timestamp: checkOutTime
  }]);
}

function logOrderInventories(order) {

  var hInvList = order.get("homeInventories");
  var homeEmail = order.get("homeEmail");
  var cOutTime = order.get("checkoutTime");
  timeinMS = new Date(cOutTime);

  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    var fInv = hInv.get("farmInv");

    var farmName = fInv.get("farmName");
    var itemName = fInv.get("name");
    var itemQty = hInv.get("homeCount");
    var itemPrice = fInv.get("rate");
    var itemUnit = fInv.get("unit");
    var itemTotAvail = fInv.get("totalAvailable");

    writeToItemSeries(homeEmail, farmName, itemName, itemQty, itemUnit, itemPrice, itemTotAvail, timeinMS);
  }

  var total = order.get("checkoutPrice");
  writeToTotalSeries(homeEmail, total, timeinMS);
}

Parse.Cloud.define('paidOrderPostForAnalytics', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.

  var orderId = request.params.orderId;

  // First get the order
  Parse.Promise.as().then(function() {

    var orderQuery = new Parse.Query('Order');
    // Find the item to purchase.
    orderQuery.equalTo("objectId", orderId);
    orderQuery.include("homeInventories");
    orderQuery.include("homeInventories.farmInv");

    /**
     * Find the results. We handle the error here so our
     * handlers don't conflict when the error propagates.
     * Notice we do this for all asynchronous calls since we
     * want to handle the error differently each time.
     */
    return orderQuery.first().then(null, function (error) {
        console.log("could not find the order", error);
        return Parse.Promise.error('DB query failed? - Order query failure.');
    });

  }).then(function(result) {
    // Make sure we found an item.
    if (!result) {
      return Parse.Promise.error('Sorry, the order is no longer available.');
    }
    order = result;

    logOrderInventories(order);

    // And we're done - send the customer Id back!
    response.success("Success!");

    /**
     * Any promise that throws an error will propagate to this handler.
     * We use it to return the error from our Cloud Function using the
     * message we individually crafted based on the failure above.
     */
  }, function(error) {

    console.log("@error catchAll: ", error.toString());

    response.error(error);
  });
});


var farmItemSeries = "itemseries";
Parse.Cloud.define('farmItempost', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.

 // var itemDescp = request.params.itemDescp;
 // var itemCategory = request.params.itemCategory;
 // var itemTotal = request.params.itemTotal;
 // var farmId = request.params.farmId;
 // var itemUnits = request.params.itemUnits;

  var itemName = request.params.itemName;
  var itemPrice = request.params.itemPrice;
  var farmName = request.params.farmName;
  var point = {value: itemPrice, time : new Date()};

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
 client.writePoint(farmItemSeries, point, {item: itemName, price: itemPrice, farm: farmName}, {db: myDB},
    function(err, resp) {
      if (err) {
        console.log("error writing inevntory value to DB", err);
        response.error(err);
      } else {
        response.success('Success writing inventory value');
      }
  });
});

/**
 * Query the time series entries from the InfluxDB.
 *
 * Returns a set of data points in the last 1 hour
 */
Parse.Cloud.define('queryFarmItem', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
var itemname = request.params.itemName;
var farmname = request.params.farmName;

//var query = "SELECT * FROM " + farmItemSeries + " WHERE time > now() - 24h";
var query = "SELECT value FROM " + farmItemSeries + " WHERE item='"+ itemname + "' and farm='" + farmname + "'";

  client.query(query, 
    function(err, resp) {
      if (err) {
        console.log("error quering farm item in DB", err);
        response.error(err);
      } else {
        assert(resp instanceof Array);
        //console.log("response is", JSON.parse(resp));
        response.success(resp);
      }
  });
});

/**
 * Miscellaneous stuff
 */
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
  });
});

Parse.Cloud.define('createBeforeSaveChangedObject', function(req, res){
  var obj = new Parse.Object('BeforeSaveChanged');
  obj.save().then(() => {
    res.success(obj);
  });
});




