const express = require("express");
const cors = require("cors");

const jwt = require("jsonwebtoken");

const Stripe = require("stripe");

const stripe = Stripe(
  "sk_test_51L4guzI3R04cGlPhpn26enCeil7nNKjVjsSRP1yT30MSwFgZVUxdcU0tvFtqDIhBgh7EW1DQDlMcejvRZcMRBDFD00IXo2TxOP"
);

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(404).send({ message: "UnAuthorized Access" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(
    token,
    "d18bd9d59f8b158ad19445fb12f4a2e9f945c498a8cbdcd064d8700dc1f8630fae00640be3585b8a4215fe137214798a332b38919a1b7c751d2b48fc",
    function (err, decoded) {
      if (err) {
        return res.status(401).send({ message: "Forbidden Access" });
      }
      req.decoded = decoded;
      next();
    }
  );
};

require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { application } = require("express");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://doctors_portal:doctors_portal@cluster0.r94p6.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();
    const toolsCollection = client.db("fixymart").collection("tools");
    const purchaseCollection = client.db("fixymart").collection("purchase");
    const usersCollection = client.db("fixymart").collection("user");
    const paymentsCollection = client.db("fixymart").collection("payments");

    // get tools from toolsCollection
    app.get("/tools", async (req, res) => {
      const tools = await toolsCollection.find().toArray();
      res.send(tools);
    });

    // create order
    app.post("/order", async (req, res) => {
      const purchase = req.body;
      const query = {
        _id: purchase.id,
      };
      const exist = await toolsCollection.findOne(query);

      if (exist.minOrder > purchase.orderQuantity) {
        res.send({ success: false });
      } else if (purchase.orderQuantity > exist.quantity) {
        res.send({ quantity: false });
      } else {
        const upQant = exist.quantity - purchase.orderQuantity;

        const updateDoc = {
          $set: {
            quantity: upQant,
          },
        };
        // update order quantity
        await toolsCollection.updateOne(query, updateDoc);
        // place order
        const result = await purchaseCollection.insertOne(purchase);
        res.send({ success: true, result });
      }
    });

    // get purchased tol ofrom toolsCollection
    app.get("/purchased", async (req, res) => {
      const user = req.query.user;
      const query = {
        email: user,
      };
      const purchased = await purchaseCollection.find(query).toArray();
      res.send(purchased);
    });

    // cancel order
    app.post("/canceled", async (req, res) => {
      const id = req.body.id;
      const uid = req.body.uid;

      const query = {
        _id: id,
      };

      const qDelete = {
        _id: ObjectId(uid),
      };

      const exist = await toolsCollection.findOne(query);
      const upQant = exist.quantity + parseInt(req.body.orderQuantity);

      const updateDoc = {
        $set: {
          quantity: upQant,
        },
      };
      // update order quantity
      const canceledData = await toolsCollection.updateOne(query, updateDoc);
      //delate data from database
      await purchaseCollection.deleteOne(qDelete);

      res.send(canceledData);
    });

    // put  signed user
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;

      const user = req.body;
      const filter = {
        email: email,
      };
      const options = { upsert: true };

      const updateDoc = {
        $set: user,
      };

      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );

      const token = jwt.sign(
        { email: email },
        "d18bd9d59f8b158ad19445fb12f4a2e9f945c498a8cbdcd064d8700dc1f8630fae00640be3585b8a4215fe137214798a332b38919a1b7c751d2b48fc",
        { expiresIn: "10h" }
      );

      res.send({ result, token });
    });

    // get all users from db

    app.get("/user", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // make admin
    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requester = req.decoded.email;
      const requesterAccount = await usersCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        const filter = {
          email: email,
        };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send({ result });
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    // remove user
    app.put("/user/remove/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      const requester = req.decoded.email;
      const requesterAccount = await usersCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        const filter = {
          email: email,
        };
        const result = await usersCollection.deleteOne(filter);
        res.send({ result });
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    });

    // get booking for payment
    app.get("/purchase/:id", async (req, res) => {
      const id = req.params.id;
      const tool = await purchaseCollection.findOne({ _id: ObjectId(id) });

      res.send(tool);
    });

    // create payment
    app.post("/create-payment-intent", async (req, res) => {
      const price = req.body.totalPrice;
      const totalAmount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // update payment
    app.patch("/payment/update/:id", async (req, res) => {
      // const id = req.params.id;
      const payment = req.body;
      const query = { _id: ObjectId(req.body._id) };
      const updateDoc = {
        $set: { paid: true, TrxID: payment.transactionId },
      };
      await purchaseCollection.updateOne(query, updateDoc);
      await paymentsCollection.insertOne(payment);
      res.send(updateDoc);
    });
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello world!");
});

app.listen(port, () => {
  console.log(port);
});
