
document.addEventListener("DOMContentLoaded", () => {
  // Mobile navigation
  const menuToggle = document.getElementById("menuToggle");
  const navigation = document.getElementById("navigation");

  menuToggle.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("open");

    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "Close navigation" : "Open navigation"
    );
    menuToggle.textContent = isOpen ? "✕" : "☰";
  });

  // Close mobile menu after selecting a link
  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navigation.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open navigation");
      menuToggle.textContent = "☰";
    });
  });

  // Tour category filters
  const filterButtons = document.querySelectorAll(".filter-btn");
  const tourCards = document.querySelectorAll(".tour-card");

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedFilter = button.dataset.filter;

      filterButtons.forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });

      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");

      tourCards.forEach((card) => {
        const matches =
          selectedFilter === "all" ||
          card.dataset.category === selectedFilter;

        card.hidden = !matches;
      });
    });
  });

  // Open a direct enquiry with the selected experience.
  document.querySelectorAll(".book-tour").forEach((link) => {
    const message = `Hello Brance Tours & Safaris, I would like to enquire about ${link.dataset.tour}.`;
    link.href = `https://wa.me/263789934035?text=${encodeURIComponent(message)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  // Search the accommodation cards already rendered on the page
  const accommodationSearch = document.getElementById("accommodationSearch");
  const clearAccommodationSearch = document.getElementById("clearAccommodationSearch");
  const accommodationSearchStatus = document.getElementById("accommodationSearchStatus");
  const accommodationCards = Array.from(
    document.querySelectorAll(".accommodation-card")
  );

  const searchAccommodations = () => {
    const query = accommodationSearch.value.trim().toLocaleLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    let visibleCount = 0;

    accommodationCards.forEach((card) => {
      const searchableText = [
        card.textContent,
        card.querySelector("img")?.alt
      ].join(" ").toLocaleLowerCase();
      const matches = terms.every((term) => searchableText.includes(term));

      card.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    accommodationSearchStatus.textContent = visibleCount
      ? query
        ? `${visibleCount} accommodation ${visibleCount === 1 ? "option" : "options"} found.`
        : `Showing all ${visibleCount} accommodation options.`
      : "No accommodation matched your search. Try another name, location, type or price.";
  };

  accommodationSearch.addEventListener("input", searchAccommodations);
  clearAccommodationSearch.addEventListener("click", () => {
    accommodationSearch.value = "";
    searchAccommodations();
    accommodationSearch.focus();
  });
  searchAccommodations();

  // Website-guided demo chat; connect a server-side AI endpoint to enable real AI
  const chatPanel = document.getElementById("chatPanel");
  const chatLauncher = document.getElementById("chatLauncher");
  const chatClose = document.getElementById("chatClose");
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatSuggestions = document.querySelector(".chat-suggestions");

  const setChatOpen = (isOpen) => {
    chatPanel.hidden = !isOpen;
    chatLauncher.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) chatInput.focus();
  };

  const addChatMessage = (text, sender) => {
    const message = document.createElement("p");
    message.className = `chat-bubble chat-${sender}`;
    message.textContent = text;
    chatMessages.append(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const getDemoReply = (question) => {
    const normalizedQuestion = question.toLocaleLowerCase();
    const asksPrices = /\b(price|prices|rate|rates|cost|costs|usd)\b/.test(normalizedQuestion);
    const asksAccommodation = /\b(accommodation|stay|stays|hotel|hotels|lodge|lodges|guesthouse|guesthouses|camp|camps|available|availability)\b/.test(normalizedQuestion);

    if (/\b(book|booking|bookings|reserve|reservation)\b/.test(normalizedQuestion)) {
      return "To enquire about a stay or booking, use a listing's Book Now button to message our team on WhatsApp, or visit Contact to send your trip details. Our team will confirm availability and rates.";
    }

    if (/\b(destination|destinations)\b/.test(normalizedQuestion)) {
      const destinations = Array.from(document.querySelectorAll(".destination-list span"))
        .map((destination) => destination.textContent.trim());
      return `The destinations listed on this page are ${destinations.join(", ")}. Contact our team to confirm which options fit your trip.`;
    }

    if (asksAccommodation || asksPrices) {
      const typeTerms = ["lodge", "hotel", "guesthouse", "safari camp"];
      const locationTerms = ["victoria falls", "livingstone", "kasane", "chobe", "hwange"];
      const requestedTypes = typeTerms
        .filter((term) => normalizedQuestion.includes(term));
      const requestedLocations = locationTerms
        .filter((term) => normalizedQuestion.includes(term));
      const requestedNames = accommodationCards
        .map((card) => card.querySelector("h3").textContent.trim().toLocaleLowerCase())
        .filter((name) => normalizedQuestion.includes(name));
      const matchingCards = accommodationCards.filter((card) => {
        const cardText = card.textContent.toLocaleLowerCase();
        const matchesType =
          !requestedTypes.length || requestedTypes.some((term) => cardText.includes(term));
        const matchesLocation =
          !requestedLocations.length || requestedLocations.some((term) => cardText.includes(term));
        const matchesName =
          !requestedNames.length || requestedNames.includes(
            card.querySelector("h3").textContent.trim().toLocaleLowerCase()
          );
        return matchesType && matchesLocation && matchesName;
      });

      if (!matchingCards.length) {
        return "I couldn't find a matching sample listing on this page. Please contact our team to ask about other locations and available stays.";
      }

      const listings = matchingCards.map((card) => {
        const name = card.querySelector("h3").textContent.trim();
        const type = card.querySelector(".tour-tag").textContent.trim();
        const price = card.querySelector(".accommodation-price").lastChild.textContent
          .replace(/\s+/g, " ").trim();
        return `${name} (${type}) — Price per night: ${price}`;
      });

      return `These are illustrative sample listings, not confirmed properties:\n${listings.join("\n")}\nRates and availability must be confirmed with our team. Use the accommodation search on this page to filter listings.`;
    }

    if (/\b(tour|tours|safari|activity|activities|experience|experiences)\b/.test(normalizedQuestion)) {
      const tours = Array.from(document.querySelectorAll(".tour-card h3"))
        .map((heading) => heading.textContent.trim())
        .slice(0, 8);
      return `You can explore tours and safari experiences in the Our Tours section. Examples include ${tours.slice(0, 4).join(", ")}. Availability and details are confirmed by our team.`;
    }

    if (/\b(where|location|locations)\b/.test(normalizedQuestion)) {
      const destinations = Array.from(document.querySelectorAll(".destination-list span"))
        .map((destination) => destination.textContent.trim());
      return `The destinations listed on this page are ${destinations.join(", ")}. Contact our team to confirm which options fit your trip.`;
    }

    return "I’m a demo assistant, not an AI service. I can share the accommodation examples, rates information, tours, destinations and booking options shown on this website. Try one of the suggested questions or contact our team for specific help.";
  };

  chatLauncher.addEventListener("click", () => {
    setChatOpen(chatPanel.hidden);
  });
  chatClose.addEventListener("click", () => setChatOpen(false));

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;

    addChatMessage(question, "visitor");
    addChatMessage(getDemoReply(question), "assistant");
    chatInput.value = "";
    chatInput.focus();
  });

  chatSuggestions.addEventListener("click", (event) => {
    const suggestion = event.target.closest("button");
    if (!suggestion) return;
    chatInput.value = suggestion.textContent.trim();
    chatForm.requestSubmit();
  });

  // Automatically update the footer year
  document.getElementById("year").textContent =
    new Date().getFullYear();

});
