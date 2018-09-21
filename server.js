'use strict';

const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const app = express();
const pg = require('pg');
require('dotenv').config();
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();

client.on('error', err => console.error(err));

app.use(cors());


app.get('/location', getLocation);

app.get('/weather', getWeather);

app.get('/movies', getMovies);

app.get('/yelp', getYelp);

app.get('/meetups', getMeetups);

app.get('/hiking', getHiking);

const PORT = process.env.PORT || 3000;

function deleteByLocationId(table, city) {
  const SQL =  `DELETE from ${table} WHERE location_id=${city};`;
  return client.query(SQL);
}

// constructor function for geolocation - called upon inside the request for location
function Location(query, result) {
  this.search_query = query;
  this.formatted_query = result.body.results[0].formatted_address,
  this.latitude = result.body.results[0].geometry.location.lat,
  this.longitude = result.body.results[0].geometry.location.lng
  this.created_at = Date.now();
}

function getLocation(request, response) {
  Location.lookupLocation({
    tableName: Location.tableName,
    query: request.query.data,
    cacheHit: function(result) {
      response.send(result);
    },
    cacheMiss: function () {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GOOGLE_API_KEY}`;
      return superagent.get(url)
        .then(result => {
          const location = new Location(this.query, result);
          location.save()
            .then(location => response.send(location));
        })
        .catch(error => handleError(error));
    }
  })
}

Location.lookupLocation = (location) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [location.query];

  return client.query(SQL,values)
    .then(result => {
      if (result.rowCount > 0) {
        location.cacheHit(result.rows[0]);
      } else {
        location.cacheMiss();
      }
    })
    .catch(console.error);
}

Location.prototype = {
  save: function() {
    const SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;`;
    const values = [
      this.search_query,
      this.formatted_query,
      this.latitude,
      this.longitude,
    ];
    return client.query(SQL, values)
      .then(result=> {
        this.id = result.rows[0].id;
        return this;
      });
  }
};



//send request to DarkSkys API and gets data back, then calls on Weather function to display data
function getWeather(request, response) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;
  return superagent.get(url)

    .then( result => {
      const weatherSummaries = result.body.daily.data.map( day => {
        return new Weather(day);
      })
      response.send(weatherSummaries)
    })
    .catch( error => handleError(error, response));
}

function Weather(day) {
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.forecast = day.summary;
}

// Yelp Api request
function getYelp(request, response) {
  const url = `https://api.yelp.com/v3/businesses/search?location=${request.query.data.search_query}`;

  superagent.get(url)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(result => {
      const businessSummaries = result.body.businesses.map(data => {
        return new Yelp(data);
      });
      response.send(businessSummaries);
    })
    .catch( error => handleError(error, response));
}

function Yelp(data) {
  this.name = data.name;
  this.image_url = data.image_url;
  this.price = data.price;
  this.rating = data.rating;
  this.url = data.url;
}

function getMovies(request, response) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_API_KEY}&query=${request.query.data.search_query}`;
  return superagent.get(url)

    .then(result => {
      const moviesSummaries = result.body.results.map(movies => {
        return new MoviesData(movies);
      })
      response.send(moviesSummaries);
    })
    .catch( error => handleError(error, response));
}

function MoviesData(movies) {
  this.title = movies.title;
  this.overview = movies.overview;
  this.average_votes = movies.vote_average;
  this.total_votes = movies.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/w200_and_h300_bestv2${movies.poster_path}`;
  this.popularity = movies.popularity;
  this.released_on = movies.release_date;
}

function getMeetups(request, response) {
  const url = `https://api.meetup.com/find/upcoming_events?&sign=true&photo-host=public&lon=${request.query.data.longitude}&page=5&lat=${request.query.data.latitude}&key=${process.env.MEETUP_API_KEY}`;
  return superagent.get(url)

    .then(result => {
      const meetupSummaries = result.body.events.map(meetups => {
        return new Meetups(meetups);
      });
      response.send(meetupSummaries);
    })
    .catch( error => handleError(error, response));
}

function Meetups(events) {
  this.link = events.link;
  this.name = events.name;
  this.creation_date = events.created;
  this.host = events.group.name;
}


function getHiking(request, response) {
  const url = `https://www.hikingproject.com/data/get-trails?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&maxDistance=10&key=${process.env.HIKING_API_KEY}`;
  return superagent.get(url)

    .then(result => {
      console.log('hello');
      const hikingSummaries = result.body.trails.map(hiking => {
        return new Hiking(hiking);
      });
      response.send(hikingSummaries);
    })
    .catch( error => handleError(error, response));
}

function Hiking(data) {
  this.name = data.name;
  this.location = data.location ;
  this.length = data.length;
  this.stars = data.stars;
  this.star_votes = data.starVote;
  this.summary = data.summary;
  this.trail_url = data.url;
  this.conditions = data.conditionDetails;
  this.condition_date = data.conditionDate.match(/\S+/g)[0];
  this.condition_time = data.conditionDate.match(/\S+/g)[1];
}


function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
