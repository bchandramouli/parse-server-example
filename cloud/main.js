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


// From here... 
// New code added for inventory processing 

// Initialize the Stripe and Mailgun Cloud Modules
var Stripe = require('stripe')("sk_test_3n3xj9zbj6hOkEhngx7uITeH");
var Mailgun = require('mailgun-js')({apiKey: "afab485a6a9bf921692f83c3c1d03b56", domain: "sandboxd6cc36b660184159bc67c3f403466981.mailgun.org"});

function stringifyHomeInventory(homeInv, price) {
  var orderStringified;
  for (var i = 0 ; i < homeInv.length; i++) {
       orderStringified = orderStringified +
        homeInv[i].get("name") +
        " * " +
        string(homeInv[i].get("homeCount")) +
        " @ " +
        string(homeInv[i].get("rate")) + 
        " per " +
        homeInv[i].get("unit") +
        "\n\n";
  }

  orderStringified = orderStringified + "\n" + "Total Price: $" + string(price) + "\n";

  return orderStringified;
}

function getHomeInventoryPrice(homeInv) {
  var price = 0;

  for (var i = 0 ; i < homeInv.length; i++) {
    price = price + homeInv[i].get("rate") * homeInv[i].get("homeCount");
  }

  return price;
}

// Purchase an item from the Parse Store using the Stripe
// Cloud Module.
// 
//  Expected input (in request.params):
//   homeId         : String, to retrieve the home details
//   cardToken      : String, the credit card token returned to the client from Stripe
//
// Also, please note that on success, "Success" will be returned. 
Parse.Cloud.define('purchaseInventory', function(request, response) {
  // Ensure only Cloud Code can get access by using the master key.
  // Parse.Cloud.useMasterKey(); 
  // XXX - this has been changed to useMasterKey: true as an option to each Parse.Query!

  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  var home, order, orderString;
  var price = 0;

  // We start in the context of a promise to keep all the
  // asynchronous code consistent. This is not required.
  Parse.Promise.as().then(function() {
    // Find the item to purchase.
    var homeQuery = new Parse.Query('Home');
    homeQuery.equalTo('objectId', request.params.homeId);
    homeQuery.include("homeInventory");

    // Find the resuts. We handle the error here so our
    // handlers don't conflict when the error propagates.
    // Notice we do this for all asynchronous calls since we
    // want to handle the error differently each time.
    return homeQuery.first().then(null, function(error) {
      return Parse.Promise.error('Sorry, the home record query failed.');
    });

  }).then(function(result) {
    // Make sure we found an item and that it's not out of stock.
    if (!result) {
      return Parse.Promise.error('Sorry, the home record is no longer available.');
    }

    home = result;
    var inventory = home.get("homeInventory");
    price = getHomeInventoryPrice(inventory);
    orderString = stringifyHomeInventory(inventry, price);

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
      console.log('Creating order object failed. Error: ' + error);
      return Parse.Promise.error('An error has occurred. Your credit card was not charged.');
    });

  }).then(function(order) { 
    // Now we can charge the credit card using Stripe and the credit card token.
    return Stripe.Charges.create({
      amount: price * 100, // express dollars in cents 
      currency: 'usd',
      card: request.params.cardToken
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
      // This is the worst place to fail since the card was charged but the order's
      // 'charged' field was not set. Here we need the user to contact us and give us
      // details of their credit card (last 4 digits) and we can then find the payment
      // on Stripe's dashboard to confirm which order to rectify. 
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
    return Mailgun.sendEmail({
      from: 'reachorchardview@gmail.com',
      to: home.get("email"),
      cc: 'reachorchardview@gmail.com',
      subject: 'Your farmer\'s market inventory was processed!',
      text: body
    }).then(null, function(error) {
      return Parse.Promise.error('Your purchase was successful, but we were not able to ' +
                                 'send you an email. Contact us at reachorchardview@gmail.com if ' +
                                 'you have any questions.');
    });

  }).then(function() {
    // And we're done!
    response.success('Success');

  // Any promise that throws an error will propagate to this handler.
  // We use it to return the error from our Cloud Function using the 
  // message we individually crafted based on the failure above.
  }, function(error) {
    response.error(error);
  });
});
