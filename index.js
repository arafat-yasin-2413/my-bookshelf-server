require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { messaging } = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-service-key.json");

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j4wv0oh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: false,
		deprecationErrors: true,
	},
});

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
	const authHeader = req.headers?.authorization;

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).send({ message: "unauthorized access" });
	}

	const token = authHeader.split(" ")[1];

	try {
		const decoded = await admin.auth().verifyIdToken(token);
		console.log("decoded token = ", decoded);
		req.decoded = decoded;
		next();
	} catch (error) {
		return res.status(401).send({ message: "unauthorized access" });
	}
};

const verifyTokenEmail = (req, res, next) => {
	if (req.query.email !== req.decoded.email) {
		res.status(403).send({ message: "forbidden access" });
	}
	next();
};
async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		await client.connect();
		console.log("Database connected----------");

		const booksCollection = client.db("bookshelfDB").collection("books");
		const usersCollection = client.db("bookshelfDB").collection("users");
		const reviewsCollection = client
			.db("bookshelfDB")
			.collection("reviews");
		const wishlistCollection = client
			.db("bookshelfDB")
			.collection("wishlist");

		// add to wishlist api
		app.post("/wishlist", async (req, res) => {
			console.log("📩 Received POST request on /wishlist");
			console.log("Request body:", req.body);
            
			try {
				const { bookId, userEmail } = req.body;
				console.log(bookId);

				if (!bookId || !userEmail) {
					return res
						.status(400)
						.json({ message: "Missing bookId or userEmail" });
				}

				// preventing duplicate wishlist document
				const exists = await wishlistCollection.findOne({
					bookId: new ObjectId(bookId),
					userEmail,
				});

				if (exists) {
					return res.status(409).json({
						success: false,
						message: "Book alredy in wishlist",
					});
				}

				const wishlistItem = {
					bookId: new ObjectId(bookId),
					userEmail,
					addedAt: new Date(Date.now()),
				};

				const result = await wishlistCollection.insertOne(wishlistItem);
				res.status(201).json({
					success: true,
					message: "Book added to wishlist successfully!",
					data: result,
				});
			} catch (error) {
				console.log("Error adding to wishlist : ", error);
				res.status(500).json({ message: "Internal Server Error" });
			}
		});

		///////////////////// APIs ///////////////////
		// book related APIs
		app.get("/bookshelf", async (req, res) => {
			const result = await booksCollection.find().toArray();
			res.send(result);
		});

		app.get("/allBooks", async (req, res) => {
			const result = await booksCollection.find().toArray();
			res.send(result);
		});

		app.get("/book/:id", async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await booksCollection.findOne(query);
			res.send(result);
		});

		// app.get("/myBooks/:email", async (req, res) => {
		//     const email = req.params.email;
		//     const filter = { userEmail: email };
		//     const books = await booksCollection.find(filter).toArray();
		//     console.log(books);
		//     res.send(books);
		// });

		app.get(
			"/myBooks",
			verifyFireBaseToken,
			verifyTokenEmail,
			async (req, res) => {
				const email = req.query.email;

				// if(email !== req.decoded.email) {
				//     return res.status(403).message({message: 'forbidden access'});
				// }

				const query = {
					userEmail: email,
				};
				const result = await booksCollection.find(query).toArray();
				res.send(result);
			}
		);

		app.get("/books/top", async (req, res) => {
			const result = await booksCollection
				.aggregate([
					{
						$addFields: {
							upvoteCount: {
								$size: { $ifNull: ["$upvotedBy", []] },
							},
						},
					},
					{
						$sort: { upvoteCount: -1 },
					},

					{
						$limit: 6,
					},
				])
				.toArray();

			res.send(result);
		});

		app.get("/books/search", async (req, res) => {
			const queryText = req.query.query;

			if (!queryText) {
				return res.status(400).send({ message: "Query text missing" });
			}

			const result = await booksCollection
				.find({
					$or: [
						{ bookTitle: { $regex: queryText, $options: "i" } },
						{ bookAuthor: { $regex: queryText, $options: "i" } },
					],
				})
				.toArray();

			res.send(result);
		});

		app.post("/addBook", async (req, res) => {
			const newBook = req.body;
			// console.log('req.body : ---> ',req.body);
			console.log(newBook);
			const result = await booksCollection.insertOne(newBook);
			res.send(result);
		});

		app.put("/book/:id", async (req, res) => {
			const id = req.params.id;
			const filter = { _id: new ObjectId(id) };
			const options = { upsert: true };
			const updatedBook = req.body;

			const updatedDoc = {
				$set: updatedBook,
			};
			const result = await booksCollection.updateOne(
				filter,
				updatedDoc,
				options
			);
			res.send(result);
		});

		app.delete("/book/:id", async (req, res) => {
			const id = req.params.id;
			// console.log('req a ki ache dekhi : ' , req);
			const query = { _id: new ObjectId(id) };
			const result = await booksCollection.deleteOne(query);
			res.send(result);
		});

		app.patch("/upvote/:bookId", async (req, res) => {
			const id = req.params.bookId;
			const email = req.body.email;
			const filter = { _id: new ObjectId(id) };
			const book = await booksCollection.findOne(filter);

			const updateDoc = {
				$push: {
					upvotedBy: email,
				},
			};

			const result = await booksCollection.updateOne(filter, updateDoc);
			res.send(result);
		});

		// user related APIs
		app.post("/users", async (req, res) => {
			const userProfile = req.body;
			console.log(userProfile);

			const result = await usersCollection.insertOne(userProfile);
			res.send(result);
		});

		app.get("/users", async (req, res) => {
			const result = await usersCollection.find().toArray();
			res.send(result);
		});
		// getting specific user
		app.get("/user/:id", async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await usersCollection.findOne(query);
			res.send(result);
		});

		// total book cound per user
		app.get(`/books/count`, async (req, res) => {
			const userEmail = req.query.email;
			if (!userEmail) {
				return res.status(400).send({ message: "Email is missing" });
			}

			const count = await booksCollection.countDocuments({ userEmail });
			res.send({ email: userEmail, count });
		});

		// book count per user by category
		app.get("/books/category-count", async (req, res) => {
			const userEmail = req.query.email;
			if (!userEmail) {
				return res.status(400).send({ message: "Email is missing" });
			}

			try {
				const result = await booksCollection
					.aggregate([
						{ $match: { userEmail } },
						{
							$group: {
								_id: "$bookCategory",
								count: { $sum: 1 },
							},
						},
						{ $project: { category: "$_id", count: 1, _id: 0 } },
					])
					.toArray();

				console.log(result);

				res.send(result);
			} catch (error) {
				console.error("Error fetching category count:", error);
				res.status(500).send({ message: "Internal server error" });
			}
		});

		// book category API
		app.get("/categories", async (req, res) => {
			const result = await booksCollection.distinct("bookCategory");
			res.send(result);
		});

		// getting books category-wise
		app.get("/books/category/:categoryName", async (req, res) => {
			const category = req.params.categoryName;
			// console.log(category);

			try {
				const books = await booksCollection
					.find({ bookCategory: category })
					.toArray();
				res.send(books);
			} catch (error) {
				console.log(error);
				res.status(500).send({
					message: "Failed to fetch books by category",
				});
			}
		});

		// reviews related APIs
		app.post("/addReview", async (req, res) => {
			const newReview = req.body;

			console.log(newReview);
			const result = await reviewsCollection.insertOne(newReview);
			res.send(result);
		});

		app.get("/reviews/:bookId", async (req, res) => {
			const id = req.params.bookId;
			const query = { bookId: id };
			const result = await reviewsCollection.find(query).toArray();
			res.send(result);
		});

		app.put("/updateReview/:id", async (req, res) => {
			const id = req.params.id;
			const filter = { _id: new ObjectId(id) };
			const options = { upsert: true };
			const updateReview = req.body;

			const updatedDoc = {
				$set: updateReview,
			};
			const result = await reviewsCollection.updateOne(
				filter,
				updatedDoc,
				options
			);
			res.send(result);
		});

		app.delete("/deleteReview/:id", async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await reviewsCollection.deleteOne(query);
			res.send(result);
		});

		// Send a ping to confirm a successful connection
		// await client.db("admin").command({ ping: 1 });
		// console.log(
		//     "Pinged your deployment. You successfully connected to MongoDB!"
		// );
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("Bookshelf server is cooking...");
});

app.listen(port, () => {
	console.log(`Bookshelf server is running hot on port ${port}`);
});
