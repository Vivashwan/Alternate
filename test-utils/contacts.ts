import type { Contact } from "@/lib/types";

export function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    name: "Asha Rao",
    fullPhoneNumber: "919876543210",
    phoneNumber: "9876543210",
    countryCode: "IN",
    appointment: "",
    location: "",
    iosRow: "",
    suffix: "",
    prefix: "",
    email: "",
    notes: "",
    website: "",
    labels: "",
    birthday: "",
    nickname: "",
    photo: "",
    ...overrides,
  };
}

const FIRST = ["Asha", "Ravi", "Meera", "Arjun", "Kavya", "Rohan", "Sneha", "Vikram", "Priya", "Aditya"];
const LAST = ["Rao", "Kumar", "Sharma", "Iyer", "Patel", "Nair", "Reddy", "Gupta", "Das", "Menon"];
const CITIES = ["Bengaluru", "Mumbai", "Chennai", "Delhi", "Pune", "Kochi"];
const ROLES = ["Dentist", "Plumber", "Electrician", "Tutor", "Courier", ""];

/** Deterministic synthetic contacts with unique phone numbers. */
export function makeContacts(count: number): Contact[] {
  return Array.from({ length: count }, (_, i) => {
    const phoneNumber = String(9_000_000_000 + i * 7919).slice(0, 10);
    return makeContact({
      name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${i}`,
      phoneNumber,
      fullPhoneNumber: `91${phoneNumber}`,
      location: CITIES[i % CITIES.length],
      appointment: ROLES[i % ROLES.length],
      email: i % 3 === 0 ? `user${i}@example.com` : "",
    });
  });
}
